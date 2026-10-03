import type { z } from 'zod'
import { ERROR_MESSAGES, statusForCode } from '../_vendor/core/api/errors.ts'
import { config } from './env.ts'

export class HttpError extends Error {
  constructor(
    readonly code: string,
    message?: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message ?? ERROR_MESSAGES[code] ?? code)
  }
  get status(): number {
    return statusForCode(this.code)
  }
}

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type, idempotency-key, x-client-key, x-booking-token'

/** CORS for an exact allowlist of origins (never "*"). */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = { vary: 'origin' }
  if (origin && config().allowedOrigins.includes(origin)) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-headers'] = ALLOW_HEADERS
    headers['access-control-allow-methods'] = 'GET, POST, PATCH, DELETE, OPTIONS'
    // Browsers cap this (Chromium 2 h, Safari 10 min); the cap is the goal: fewer preflight round trips.
    headers['access-control-max-age'] = '7200'
  }
  return headers
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

export function json(req: Request, data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...corsHeaders(req), ...extra },
  })
}

export function errorResponse(req: Request, e: unknown, fn: string): Response {
  if (e instanceof HttpError) {
    return json(req, { error: { code: e.code, message: e.message } }, e.status, e.headers)
  }
  // Never echo internal messages (they can contain row data); log the shape only.
  const name = e instanceof Error ? e.name : typeof e
  console.error(`[${fn}] unhandled ${name}`)
  return json(req, { error: { code: 'INTERNAL', message: ERROR_MESSAGES.INTERNAL } }, 500)
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) })
}

/** Reads a JSON body with a hard byte cap (also for chunked bodies without Content-Length). */
export async function readJson(req: Request, maxBytes = 32 * 1024): Promise<unknown> {
  const bytes = await readBytes(req, maxBytes)
  if (bytes.length === 0) return {}
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new HttpError('BAD_REQUEST', 'Некорректный JSON')
  }
}

export async function readBytes(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > maxBytes) throw new HttpError('PAYLOAD_TOO_LARGE', 'Слишком большой запрос')
  if (!req.body) return new Uint8Array()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new HttpError('PAYLOAD_TOO_LARGE', 'Слишком большой запрос')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data)
  if (!r.success) {
    const first = r.error.issues[0]
    const where = first?.path.length ? ` (${first.path.join('.')})` : ''
    throw new HttpError('VALIDATION', `${ERROR_MESSAGES.VALIDATION}${where}`)
  }
  return r.data
}

export function idempotencyKey(req: Request): string {
  const key = req.headers.get('idempotency-key')
  if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new HttpError('IDEMPOTENCY_KEY_REQUIRED', 'Нужен заголовок Idempotency-Key')
  return key
}

export interface RouteContext {
  req: Request
  params: Record<string, string>
  url: URL
}

export interface Route {
  method: string
  path: string
  handle: (ctx: RouteContext) => Promise<Response>
}

/** Matches `/t/:slug/bookings/:id` style patterns against the path after the function name. */
export function router(fn: string, routes: Route[]) {
  const compiled = routes.map((r) => ({
    ...r,
    re: new RegExp('^' + r.path.replace(/:([a-z_]+)/g, (_, name: string) => `(?<${name}>[^/]+)`) + '/?$'),
  }))
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflight(req)
    const url = new URL(req.url)
    // Hosted Edge Runtime passes /<fn>/...; the local gateway passes /functions/v1/<fn>/...
    const path = url.pathname.replace(new RegExp(`^.*?/${fn}(?=/|$)`), '') || '/'
    try {
      let methodMismatch = false
      for (const r of compiled) {
        const m = r.re.exec(path)
        if (!m) continue
        if (r.method !== req.method) {
          methodMismatch = true
          continue
        }
        const params = Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]))
        return await r.handle({ req, params, url })
      }
      throw new HttpError(methodMismatch ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', methodMismatch ? 'Метод не поддерживается' : 'Не найдено')
    } catch (e) {
      return errorResponse(req, e, fn)
    }
  }
}
