import { createHash, randomBytes, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { expect, inject } from 'vitest'

export type Sql = postgres.Sql
export type Tx = postgres.TransactionSql
type Row = Record<string, unknown>

export const sql: Sql = postgres(inject('databaseUrl'), { max: 30, onnotice: () => {} })

export function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest()
}

export function newSecret(): string {
  return randomBytes(32).toString('base64url')
}

/** Runs fn as the service role (what Edge Functions use). */
export async function asService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`set local role service_role`
    return fn(tx)
  })) as T
}

/** Runs fn as an authenticated Supabase user, exactly as PostgREST would. */
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`
    await tx`set local role authenticated`
    return fn(tx)
  })) as T
}

export async function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'anon' })}, true)`
    await tx`set local role anon`
    return fn(tx)
  })) as T
}

export async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  let error: unknown = null
  try {
    await promise
  } catch (e) {
    error = e
  }
  expect(error, `expected error ${code}`).not.toBeNull()
  expect((error as Error).message).toBe(code)
}

export async function createUser(email = `${randomUUID()}@test.local`): Promise<string> {
  const id = randomUUID()
  await sql`insert into auth.users (id, email, aud, role, instance_id, created_at, updated_at)
            values (${id}, ${email}, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())`
  return id
}

export interface ServiceFixture {
  key: string
  name?: string
  duration_min: number
  price_cents: number
  buffer_before_min?: number
  buffer_after_min?: number
  resource_types?: string[]
  multi_day?: boolean
  requires_confirmation?: boolean
  variants?: { body_type: string; price_cents: number; duration_min: number }[]
  addons?: { key: string; name: string; price_cents: number; duration_min: number }[]
  repeat_interval_days?: number | null
  recommended_keys?: string[]
}

export interface TenantOptions {
  slug?: string
  name?: string
  timezone?: string
  status?: 'draft' | 'demo' | 'live'
  hours?: { weekday: number; opens: string; closes: string }[]
  exceptions?: { day: string; closed: boolean; opens?: string | null; closes?: string | null; note?: string }[]
  resources?: { key: string; name: string; type: string }[]
  services?: ServiceFixture[]
  policy?: Partial<{
    slot_step_min: number
    min_notice_min: number
    horizon_days: number
    cancel_cutoff_hours: number
    requires_confirmation: boolean
    max_active_bookings_per_phone: number
  }>
}

export interface Tenant {
  id: string
  slug: string
  timezone: string
  ownerId: string
  config: Row
  services: Record<string, string>
  addons: Record<string, string>
  resources: Record<string, string>
}

export const everyDay = (opens = '09:00', closes = '21:00') =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens, closes }))

export function tenantConfig(id: string, ownerId: string, o: TenantOptions = {}): Row {
  const slug = o.slug ?? `t-${id.slice(0, 8)}`
  return {
    id,
    slug,
    name: o.name ?? `Test ${slug}`,
    status: o.status ?? 'live',
    timezone: o.timezone ?? 'Europe/Moscow',
    locale: 'ru-RU',
    currency: 'RUB',
    settings: {
      tagline: 'Test studio',
      description: '',
      address: 'Test street 1',
      map_url: null,
      phone: '+74950000000',
      email: null,
      website: null,
      socials: [],
      branding: { themePreset: 'graphite', demoArtwork: false },
      seo: {},
      features: { ai: true },
      policy: {
        slot_step_min: 30,
        min_notice_min: 60,
        horizon_days: 120,
        cancel_cutoff_hours: 24,
        requires_confirmation: false,
        max_active_bookings_per_phone: 10,
        ...o.policy,
      },
      notifications: { reminder_hours_before: 24, owner_push: true, client_push: true },
      ai: { daily_request_limit: 5, daily_token_budget: 100000 },
    },
    hours: o.hours ?? everyDay(),
    exceptions: (o.exceptions ?? []).map((e) => ({ opens: null, closes: null, note: '', ...e })),
    resources: (o.resources ?? [{ key: 'bay-1', name: 'Бокс 1', type: 'detail_bay' }]).map((r, i) => ({ ...r, sort_order: i })),
    services: (
      o.services ?? [
        {
          key: 'wash',
          duration_min: 60,
          buffer_after_min: 30,
          price_cents: 300000,
          variants: [{ body_type: 'suv', price_cents: 400000, duration_min: 90 }],
          addons: [{ key: 'wheels', name: 'Диски', price_cents: 150000, duration_min: 30 }],
          repeat_interval_days: 30,
        },
      ]
    ).map((s, i) => ({
      name: s.key,
      category: 'other',
      summary: '',
      description: '',
      buffer_before_min: 0,
      buffer_after_min: 0,
      resource_types: ['detail_bay'],
      multi_day: false,
      requires_confirmation: false,
      allowed_body_types: null,
      benefits: [],
      prep_notes: [],
      restrictions: [],
      recommended_keys: [],
      repeat_interval_days: null,
      bookable_online: true,
      sort_order: i,
      variants: [],
      addons: [],
      ...s,
    })),
    media: [],
    members: [{ user_id: ownerId, role: 'owner' }],
  }
}

export async function publish(config: Row, overwrite = false): Promise<Row> {
  return asService(async (tx) => {
    const [r] = await tx`select public.api_admin_publish_tenant(${tx.json(config as postgres.JSONValue)}, ${'h-' + Date.now()}, ${overwrite}) as r`
    return r!.r as Row
  })
}

export async function createTenant(o: TenantOptions = {}): Promise<Tenant> {
  const id = randomUUID()
  const ownerId = await createUser()
  const config = tenantConfig(id, ownerId, o)
  await publish(config)
  const services = Object.fromEntries(
    (await sql<{ key: string; id: string }[]>`select key, id from public.services where tenant_id = ${id}`).map((r) => [r.key, r.id]),
  )
  const addons = Object.fromEntries(
    (await sql<{ key: string; id: string }[]>`select key, id from public.service_addons where tenant_id = ${id}`).map((r) => [r.key, r.id]),
  )
  const resources = Object.fromEntries(
    (await sql<{ key: string; id: string }[]>`select key, id from public.resources where tenant_id = ${id}`).map((r) => [r.key, r.id]),
  )
  return { id, slug: config.slug as string, timezone: config.timezone as string, ownerId, config, services, addons, resources }
}

/** Tenant-local date `offset` days from today, as YYYY-MM-DD. */
export async function localDay(tz: string, offset: number): Promise<string> {
  const [r] = await sql<{ d: string }[]>`select to_char((now() at time zone ${tz})::date + ${offset}::int, 'YYYY-MM-DD') as d`
  return r!.d
}

/** Tenant-local wall clock -> ISO instant. */
export async function at(tz: string, day: string, time: string): Promise<string> {
  const [r] = await sql<{ t: Date }[]>`select ((${day}::date + ${time}::time) at time zone ${tz}) as t`
  return r!.t.toISOString()
}

export interface BookOptions {
  serviceKey?: string
  startsAt: string
  phone?: string
  name?: string
  vehicle?: Row
  addonKeys?: string[]
  idempotencyKey?: string
  requestHash?: string
  profileKey?: string
  createProfile?: boolean
  token?: string
}

export interface BookResult {
  booking: Row & { id: string; price_cents: number; status: string }
  profile_id: string
  replayed: boolean
  token: string
  profileKey: string
}

export async function clientBook(t: Tenant, o: BookOptions, db: Sql | Tx = sql): Promise<BookResult> {
  const token = o.token ?? newSecret()
  const profileKey = o.profileKey ?? newSecret()
  const payload = {
    service_id: t.services[o.serviceKey ?? 'wash'],
    addon_ids: (o.addonKeys ?? []).map((k) => t.addons[k]),
    starts_at: o.startsAt,
    vehicle: o.vehicle ?? { make: 'BMW', model: 'X5', body_type: 'sedan' },
    contact: { name: o.name ?? 'Иван Клиент', phone: o.phone ?? `+7916${Math.floor(1000000 + Math.random() * 8999999)}` },
    note: '',
  }
  const run = async (tx: Tx) => {
    await tx`set local role service_role`
    const [r] = await tx`select public.api_public_create_booking(
      ${t.slug}, ${o.idempotencyKey ?? randomUUID()}, ${sha256(o.requestHash ?? randomUUID()).toString('hex')},
      ${tx.json(payload as never)}, ${sha256(profileKey)}, ${o.createProfile ?? !o.profileKey}, ${sha256(token)}) as r`
    return r!.r as Omit<BookResult, 'token' | 'profileKey'>
  }
  const result = 'begin' in db ? await (db as Sql).begin(run) : await run(db as Tx)
  return { ...(result as Omit<BookResult, 'token' | 'profileKey'>), token, profileKey }
}

export async function ownerCall<T = Row>(userId: string, fn: string, ...args: unknown[]): Promise<T> {
  return asUser(userId, async (tx) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ')
    const [r] = await tx.unsafe(`select public.${fn}(${placeholders}) as r`, args as postgres.ParameterOrJSON<never>[])
    return r!.r as T
  })
}

export async function count(query: PromiseLike<readonly Row[]>): Promise<number> {
  const rows = await query
  return Number(rows[0]!.n)
}

export async function activeOccupancies(bookingId: string) {
  return sql<{ resource_id: string; during: string; released_at: Date | null }[]>`
    select resource_id, during::text as during, released_at from public.resource_occupancies
    where booking_id = ${bookingId} order by created_at`
}

export async function availability(t: Tenant, day: string, days = 1, serviceKey = 'wash', bodyType: string | null = null) {
  return asService(async (tx) => {
    const [r] = await tx`select public.api_public_availability(${t.slug}, ${t.services[serviceKey]!}, ${bodyType}, ${[]}::uuid[], ${day}::date, ${days}) as r`
    return r!.r as { slots: { starts_at: string; local_time: string; local_day: string }[]; price_cents: number; work_minutes: number }
  })
}
