import { randomUUID } from 'node:crypto'
import { inject } from 'vitest'
import { tenantConfig, type TenantOptions } from '../fixtures/tenant.ts'

export const env = inject('api')
export const FN = `${env.gateway}/functions/v1`

export function randomIp(): string {
  const b = () => Math.floor(Math.random() * 250) + 1
  return `10.${b()}.${b()}.${b()}`
}

export interface Client {
  ip: string
  clientKey?: string | null
  token?: string | null
  origin?: string
}

export interface ApiResponse<T = unknown> {
  status: number
  body: T
  headers: Headers
}

/** Calls an Edge Function through the gateway as a browser would (plus a per-test IP). */
export async function call<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string>; client?: Client } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { apikey: env.anonKey, ...init.headers }
  const c = init.client
  if (c) {
    headers['x-forwarded-for'] = c.ip
    if (c.clientKey) headers['x-client-key'] = c.clientKey
    if (c.token) headers['x-booking-token'] = c.token
    if (c.origin) headers.origin = c.origin
  }
  let body = init.body
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.json)
  }
  const res = await fetch(`${FN}${path}`, { method: init.method ?? 'GET', headers, body })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    /* non-JSON (ICS) */
  }
  return { status: res.status, body: parsed as T, headers: res.headers }
}

async function service(path: string, init: { method?: string; json?: unknown } = {}) {
  const res = await fetch(`${env.gateway}${path}`, {
    method: init.method ?? 'POST',
    headers: { apikey: env.serviceKey, authorization: `Bearer ${env.serviceKey}`, 'content-type': 'application/json' },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text}`)
  return text ? (JSON.parse(text) as Record<string, unknown>) : {}
}

export async function createOwner(email = `owner-${randomUUID()}@test.local`, password = 'test-owner-password') {
  const u = await service('/auth/v1/admin/users', { json: { email, password, email_confirm: true } })
  return { id: u.id as string, email, password }
}

export interface ApiTenant {
  id: string
  slug: string
  timezone: string
  owner: { id: string; email: string; password: string }
  services: Record<string, string>
  addons: Record<string, string>
}

export async function createTenant(o: TenantOptions = {}): Promise<ApiTenant> {
  const owner = await createOwner()
  const id = randomUUID()
  const config = tenantConfig(id, owner.id, { slug: `api-${id.slice(0, 8)}`, ...o })
  await service('/rest/v1/rpc/api_admin_publish_tenant', { json: { p_config: config, p_config_hash: 'api-test', p_overwrite: false } })
  const rows = async (table: string) =>
    (await fetch(`${env.gateway}/rest/v1/${table}?select=id,key&tenant_id=eq.${id}`, {
      headers: { apikey: env.serviceKey, authorization: `Bearer ${env.serviceKey}` },
    }).then((r) => r.json())) as { id: string; key: string }[]
  return {
    id,
    slug: config.slug as string,
    timezone: config.timezone as string,
    owner,
    services: Object.fromEntries((await rows('services')).map((s) => [s.key, s.id])),
    addons: Object.fromEntries((await rows('service_addons')).map((a) => [a.key, a.id])),
  }
}

/** Local wall-clock -> ISO instant in a timezone (via Intl, no DST assumptions). */
export function localIso(tz: string, daysAhead: number, time: string): string {
  const now = new Date()
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.getTime() + daysAhead * 86400_000))
  const [h, m] = time.split(':').map(Number) as [number, number]
  // Guess UTC, then correct by the zone offset at that instant.
  const guess = new Date(`${day}T${time}:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(guess)
  const lh = Number(parts.find((p) => p.type === 'hour')!.value)
  const lm = Number(parts.find((p) => p.type === 'minute')!.value)
  const diff = (lh * 60 + lm - (h * 60 + m)) * 60_000
  return new Date(guess.getTime() - diff).toISOString()
}

export function bookingBody(t: ApiTenant, startsAt: string, extra: Record<string, unknown> = {}) {
  return {
    service_id: t.services.wash,
    addon_ids: [],
    starts_at: startsAt,
    vehicle: { make: 'BMW', model: 'X5', body_type: 'suv' },
    contact: { name: 'Тест Клиент', phone: `8 916 ${Math.floor(100 + Math.random() * 899)}-${Math.floor(10 + Math.random() * 89)}-${Math.floor(10 + Math.random() * 89)}` },
    ...extra,
  }
}

export async function signInOwner(email: string, password: string): Promise<string> {
  const res = await fetch(`${env.gateway}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new Error(`sign-in failed: ${JSON.stringify(body)}`)
  return body.access_token
}
