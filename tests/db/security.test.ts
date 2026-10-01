import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  count,
  asAnon,
  asService,
  asUser,
  at,
  clientBook,
  createTenant,
  createUser,
  expectCode,
  localDay,
  newSecret,
  ownerCall,
  sha256,
  sql,
  type BookResult,
  type Tenant,
} from './helpers.ts'


let a: Tenant
let b: Tenant
let bookingA: BookResult
let bookingB: BookResult

beforeAll(async () => {
  a = await createTenant({ slug: 'iso-alpha' })
  b = await createTenant({ slug: 'iso-bravo' })
  const day = await localDay(a.timezone, 3)
  bookingA = await clientBook(a, { startsAt: await at(a.timezone, day, '10:00'), phone: '+79160000101', name: 'Клиент А' })
  bookingB = await clientBook(b, { startsAt: await at(b.timezone, day, '10:00'), phone: '+79160000102', name: 'Клиент Б' })
  await ownerCall(b.ownerId, 'owner_record_payment', b.id, { booking_id: bookingB.booking.id, method: 'card', amount_cents: 100000 })
  await ownerCall(b.ownerId, 'owner_update_booking', bookingB.booking.id, { internal_note: 'секрет студии Б' })
})

afterAll(async () => {
  await sql.end()
})

const tenantTables = [
  'tenants', 'tenant_settings', 'tenant_members', 'resources', 'services', 'service_variants', 'service_addons',
  'business_hours', 'business_exceptions', 'media', 'customers', 'customer_vehicles', 'bookings', 'booking_items',
  'resource_occupancies', 'booking_events', 'payments', 'notification_jobs', 'customer_overview',
]

describe('tenant isolation (RLS)', () => {
  it('owner of A sees only A in every table', async () => {
    await asUser(a.ownerId, async (tx) => {
      for (const table of tenantTables) {
        const col = table === 'tenants' ? 'id' : 'tenant_id'
        const rows = await tx.unsafe(`select distinct ${col}::text as t from public.${table}`)
        const ids = rows.map((r) => r.t)
        expect(ids.every((id) => id === a.id), `${table} leaked ${ids.join(',')}`).toBe(true)
      }
      const bookings = await tx`select id from public.bookings`
      expect(bookings.map((r) => r.id)).toEqual([bookingA.booking.id])
    })
  })

  it('owner of A cannot act on B through owner RPCs', async () => {
    await expectCode(ownerCall(a.ownerId, 'owner_cancel_booking', bookingB.booking.id, 'x'), 'NOT_FOUND')
    await expectCode(ownerCall(a.ownerId, 'owner_stats', b.id, '2026-01-01', '2026-01-31'), 'NOT_FOUND')
    await expectCode(ownerCall(a.ownerId, 'owner_record_payment', b.id, { method: 'cash', amount_cents: 1 }), 'NOT_FOUND')
    await expectCode(ownerCall(a.ownerId, 'owner_update_settings', b.id, { tagline: 'hacked' }), 'NOT_FOUND')
    const [row] = await sql`select status from public.bookings where id = ${bookingB.booking.id}`
    expect(row!.status).toBe('confirmed')
  })

  it('a user with no membership sees nothing', async () => {
    const stranger = await createUser()
    await asUser(stranger, async (tx) => {
      for (const table of tenantTables) {
        const rows = await tx.unsafe(`select 1 from public.${table} limit 1`)
        expect(rows, table).toHaveLength(0)
      }
    })
  })

  it('staff cannot read payments; managers can', async () => {
    const staff = await createUser()
    const manager = await createUser()
    await sql`insert into public.tenant_members (tenant_id, user_id, role) values (${b.id}, ${staff}, 'staff'), (${b.id}, ${manager}, 'manager')`
    expect(await asUser(staff, (tx) => tx`select id from public.payments`)).toHaveLength(0)
    expect(await asUser(manager, (tx) => tx`select id from public.payments`)).toHaveLength(1)
    await expectCode(ownerCall(staff, 'owner_cancel_booking', bookingB.booking.id, 'x'), 'FORBIDDEN')
    const stats = await ownerCall<{ money_visible: boolean; payments: unknown }>(staff, 'owner_stats', b.id, '2026-01-01', '2026-01-31')
    expect(stats.money_visible).toBe(false)
    expect(stats.payments).toBeNull()
  })

  it('authenticated users cannot write tables directly', async () => {
    await expect(asUser(a.ownerId, (tx) => tx`update public.bookings set price_cents = 1`)).rejects.toThrow(/permission denied/)
    await expect(asUser(a.ownerId, (tx) => tx`insert into public.payments (tenant_id, kind, method, amount_cents, currency) values (${a.id}, 'payment', 'cash', 1, 'RUB')`))
      .rejects.toThrow(/permission denied/)
    await expect(asUser(a.ownerId, (tx) => tx`delete from public.resource_occupancies`)).rejects.toThrow(/permission denied/)
  })
})

describe('anonymous access', () => {
  it('anon can read no table and execute no function', async () => {
    for (const table of tenantTables) {
      await expect(asAnon((tx) => tx.unsafe(`select 1 from public.${table} limit 1`)), table).rejects.toThrow(/permission denied/)
    }
    await expect(asAnon((tx) => tx`select public.api_public_bootstrap(${a.slug})`)).rejects.toThrow(/permission denied/)
    await expect(asAnon((tx) => tx`select public.owner_stats(${a.id}, '2026-01-01', '2026-01-02')`)).rejects.toThrow(/permission denied/)
  })

  it('authenticated users cannot call service-role api_* functions', async () => {
    await expect(asUser(a.ownerId, (tx) => tx`select public.api_public_bootstrap(${a.slug})`)).rejects.toThrow(/permission denied/)
    await expect(asUser(a.ownerId, (tx) => tx`select public.api_notifications_lease('w', 10, 30)`)).rejects.toThrow(/permission denied/)
  })
})

describe('grants audit', () => {
  it('privileges match the declared model exactly', async () => {
    const anonTables = await sql`select table_name from information_schema.role_table_grants
                                 where grantee = 'anon' and table_schema in ('public', 'private')`
    expect(anonTables).toHaveLength(0)
    const authWrite = await sql`select table_name, privilege_type from information_schema.role_table_grants
                                where grantee = 'authenticated' and table_schema = 'public' and privilege_type <> 'SELECT'`
    expect(authWrite).toHaveLength(0)
    const authRead = await sql`select table_name from information_schema.role_table_grants
                               where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'SELECT'`
    expect(new Set(authRead.map((r) => r.table_name))).toEqual(new Set(tenantTables))
    const fns = await sql`select p.proname,
        has_function_privilege('anon', p.oid, 'execute') as anon,
        has_function_privilege('authenticated', p.oid, 'execute') as auth,
        has_function_privilege('service_role', p.oid, 'execute') as service
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'`
    for (const f of fns) {
      expect(f.anon, `${f.proname} executable by anon`).toBe(false)
      if (String(f.proname).startsWith('owner_')) expect(f.auth, f.proname).toBe(true)
      if (String(f.proname).startsWith('api_')) {
        expect(f.auth, `${f.proname} executable by authenticated`).toBe(false)
        expect(f.service, f.proname).toBe(true)
      }
    }
    const privateExec = await sql`select p.proname from pg_proc p
      where p.pronamespace = 'private'::regnamespace and has_function_privilege('anon', p.oid, 'execute')`
    expect(privateExec).toHaveLength(0)
  })

  it('RLS is enabled on every public table and every security-definer function pins search_path', async () => {
    const noRls = await sql`select c.relname from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity`
    expect(noRls).toHaveLength(0)
    const unpinned = await sql`select p.proname from pg_proc p
      where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prosecdef
        and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')`
    expect(unpinned).toHaveLength(0)
  })

  it('every tenant-owned table carries tenant_id', async () => {
    const missing = await sql`select c.relname from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> 'tenants'
        and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)`
    expect(missing).toHaveLength(0)
  })
})

describe('capability tokens', () => {
  it('no plaintext token or device key is stored anywhere', async () => {
    const needles = [bookingA.token, bookingA.profileKey, bookingB.token]
    const cols = await sql`select table_schema, table_name, column_name, data_type from information_schema.columns
      where table_schema in ('public', 'private', 'auth') and data_type in ('text', 'jsonb', 'bytea', 'character varying', 'ARRAY')
        and table_name in (select table_name from information_schema.tables where table_type = 'BASE TABLE')`
    for (const c of cols) {
      for (const needle of needles) {
        const expr = c.data_type === 'bytea' ? `encode(${c.column_name}, 'escape')` : `${c.column_name}::text`
        const hits = await sql.unsafe(`select 1 from ${c.table_schema}.${c.table_name} where position($1 in ${expr}) > 0 limit 1`, [needle])
        expect(hits, `${c.table_schema}.${c.table_name}.${c.column_name}`).toHaveLength(0)
      }
    }
    const [tok] = await sql`select token_hash from public.booking_access_tokens where booking_id = ${bookingA.booking.id}`
    expect(Buffer.compare(tok!.token_hash, sha256(bookingA.token))).toBe(0)
  })

  it('a token works only for its booking and its tenant', async () => {
    const view = await asService(async (tx) => {
      const [r] = await tx`select public.api_public_booking(${a.slug}, ${sha256(bookingA.token)}, null, null) as r`
      return r!.r as { booking: { id: string; internal_note?: unknown; customer?: unknown } }
    })
    expect(view.booking.id).toBe(bookingA.booking.id)
    expect(view.booking.internal_note).toBeUndefined()
    expect(view.booking.customer).toBeUndefined()
    // token of A presented on B's slug
    await expectCode(asService((tx) => tx`select public.api_public_booking(${b.slug}, ${sha256(bookingA.token)}, null, null)`), 'BOOKING_NOT_FOUND')
    // random token
    await expectCode(asService((tx) => tx`select public.api_public_booking(${a.slug}, ${sha256(newSecret())}, null, null)`), 'BOOKING_NOT_FOUND')
    // token of A plus the id of another booking
    await expectCode(
      asService((tx) => tx`select public.api_public_booking(${b.slug}, ${sha256(bookingA.token)}, null, ${bookingB.booking.id})`),
      'BOOKING_NOT_FOUND',
    )
  })
})

describe('garage isolation', () => {
  it('a profile sees only its own vehicles and bookings, even when another profile uses the same phone', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const phone = '+79168880000'
    const first = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00'), phone, vehicle: { make: 'Porsche', model: '911', body_type: 'coupe' } })
    // Someone else books with the same phone from another device
    const second = await clientBook(t, { startsAt: await at(t.timezone, day, '14:00'), phone, vehicle: { make: 'Lada', model: 'Vesta', body_type: 'sedan' } })
    const profile = async (key: string) =>
      asService(async (tx) => {
        const [r] = await tx`select public.api_public_profile(${t.slug}, ${sha256(key)}) as r`
        return r!.r as { vehicles: { make: string }[]; bookings: { id: string }[] }
      })
    const p1 = await profile(first.profileKey)
    const p2 = await profile(second.profileKey)
    expect(p1.vehicles.map((v) => v.make)).toEqual(['Porsche'])
    expect(p2.vehicles.map((v) => v.make)).toEqual(['Lada'])
    expect(p1.bookings.map((x) => x.id)).toEqual([first.booking.id])
    // The studio CRM merges them into one customer
    const n = await count(sql`select count(*)::int n from public.customers where tenant_id = ${t.id} and phone_e164 = ${phone}`)
    expect(n).toBe(1)
    // A profile cannot address another profile's booking or vehicle
    await expectCode(
      asService((tx) => tx`select public.api_public_booking(${t.slug}, null, ${sha256(second.profileKey)}, ${first.booking.id})`),
      'BOOKING_NOT_FOUND',
    )
    const vehicleOfFirst = (first.booking.vehicle as { id: string }).id
    await expectCode(
      asService((tx) => tx`select public.api_public_vehicle_archive(${t.slug}, ${sha256(second.profileKey)}, ${vehicleOfFirst})`),
      'VEHICLE_NOT_FOUND',
    )
  })

  it('a revoked device key stops working', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const r = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    await asService((tx) => tx`select public.api_public_profile_revoke(${t.slug}, ${sha256(r.profileKey)})`)
    await expectCode(asService((tx) => tx`select public.api_public_profile(${t.slug}, ${sha256(r.profileKey)})`), 'PROFILE_NOT_FOUND')
  })
})

describe('client scope data shape', () => {
  it('client-facing functions never expose owner-only fields', async () => {
    const owner = JSON.stringify(await ownerCall(b.ownerId, 'owner_update_booking', bookingB.booking.id, { client_note: 'Ждём вас' }))
    expect(owner).toContain('секрет студии Б')
    const client = JSON.stringify(await asService(async (tx) => {
      const [r1] = await tx`select public.api_public_booking(${b.slug}, ${sha256(bookingB.token)}, null, null) as r`
      const [r2] = await tx`select public.api_public_profile(${b.slug}, ${sha256(bookingB.profileKey)}) as r`
      const [r3] = await tx`select public.api_public_bootstrap(${b.slug}) as r`
      return [r1!.r, r2!.r, r3!.r]
    }))
    expect(client).toContain('Ждём вас')
    for (const secret of ['секрет студии Б', 'internal_note', 'owner_notes', 'paid_cents', 'key_hash', 'token_hash', '+79160000101']) {
      expect(client, secret).not.toContain(secret)
    }
  })
})
