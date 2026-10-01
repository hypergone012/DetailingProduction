/**
 * Server-side Supabase access for the tenant pipeline (Node). Uses the SERVICE ROLE key:
 * run only on an operator machine or in CI, never ship it to a browser.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Env {
  url: string
  serviceKey: string
  /** Public anon key, used where a check must look exactly like a browser request. */
  anonKey: string | null
  appUrl: string
  local: boolean
}

export function loadEnv(): Env {
  let url = process.env.SUPABASE_URL
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  let anonKey = process.env.SUPABASE_ANON_KEY ?? null
  let local = false
  const keysFile = join(import.meta.dirname, '../../../.local/keys.json')
  if ((!url || !serviceKey) && existsSync(keysFile)) {
    const keys = JSON.parse(readFileSync(keysFile, 'utf8')) as { url: string; serviceRoleKey: string; anonKey: string }
    url ??= keys.url
    serviceKey ??= keys.serviceRoleKey
    anonKey ??= keys.anonKey
    local = true
  }
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or run the local stack)')
  }
  return { url: url.replace(/\/$/, ''), serviceKey, anonKey, appUrl: (process.env.APP_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, ''), local }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message)
  }
}

async function call(env: Env, path: string, init: RequestInit & { json?: unknown } = {}): Promise<unknown> {
  const headers = new Headers(init.headers)
  headers.set('apikey', env.serviceKey)
  headers.set('authorization', `Bearer ${env.serviceKey}`)
  let body = init.body
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const res = await fetch(env.url + path, { ...init, headers, body })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    /* plain text body */
  }
  if (!res.ok) {
    const msg = (parsed as { message?: string; msg?: string; error?: string } | null)?.message ?? (parsed as { msg?: string } | null)?.msg ?? text
    throw new ApiError(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${msg}`, res.status, parsed)
  }
  return parsed
}

/** GET with the service role (REST, Storage, Functions paths under SUPABASE_URL). */
export function get<T>(env: Env, path: string): Promise<T> {
  return call(env, path) as Promise<T>
}

export function rpc<T>(env: Env, fn: string, args: Record<string, unknown>): Promise<T> {
  return call(env, `/rest/v1/rpc/${fn}`, { method: 'POST', json: args }) as Promise<T>
}

/** Uploads an object; an existing object at the same (content-addressed) path is fine. */
export async function upload(env: Env, bucket: string, path: string, data: Buffer, contentType: string): Promise<'uploaded' | 'exists'> {
  try {
    await call(env, `/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: { 'content-type': contentType, 'cache-control': 'max-age=31536000, immutable', 'x-upsert': 'false' },
      body: new Uint8Array(data),
    })
    return 'uploaded'
  } catch (e) {
    if (e instanceof ApiError && (e.status === 409 || (e.status === 400 && /exist|duplicate/i.test(JSON.stringify(e.body))))) return 'exists'
    throw e
  }
}

export function publicUrl(env: Env, bucket: string, path: string): string {
  return `${env.url}/storage/v1/object/public/${bucket}/${path}`
}

interface AuthUser {
  id: string
  email?: string
}

export async function findUserByEmail(env: Env, email: string): Promise<AuthUser | null> {
  for (let page = 1; page <= 50; page++) {
    const res = (await call(env, `/auth/v1/admin/users?page=${page}&per_page=200`)) as { users: AuthUser[] }
    const hit = res.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit
    if (res.users.length < 200) return null
  }
  return null
}

export async function createUser(env: Env, email: string, password: string | null): Promise<AuthUser> {
  const body: Record<string, unknown> = { email, email_confirm: true }
  if (password) body.password = password
  return (await call(env, '/auth/v1/admin/users', { method: 'POST', json: body })) as AuthUser
}

export async function setPassword(env: Env, userId: string, password: string): Promise<void> {
  await call(env, `/auth/v1/admin/users/${userId}`, { method: 'PUT', json: { password } })
}

/** One-time link for an owner to set their password (sent by the operator). */
export async function recoveryLink(env: Env, email: string, redirectTo: string): Promise<string> {
  const res = (await call(env, '/auth/v1/admin/generate_link', {
    method: 'POST',
    json: { type: 'recovery', email, redirect_to: redirectTo },
  })) as { action_link?: string; properties?: { action_link?: string } }
  return res.action_link ?? res.properties?.action_link ?? ''
}

export async function fetchStatus(url: string, init?: RequestInit): Promise<{ status: number; body: string; headers: Headers }> {
  const res = await fetch(url, init)
  return { status: res.status, body: await res.text(), headers: res.headers }
}
