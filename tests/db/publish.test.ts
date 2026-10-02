import { afterAll, describe, expect, it } from 'vitest'
import { at, clientBook, count, createTenant, expectCode, localDay, ownerCall, publish, sql } from './helpers.ts'


afterAll(async () => {
  await sql.end()
})

type Report = { created: string[]; updated: string[]; kept_owner_edits: string[]; deactivated: string[]; deleted: string[]; unchanged: number }

async function snapshot(tenantId: string) {
  const q = async (table: string) => sql.unsafe(`select to_jsonb(x) - 'updated_at' as r from public.${table} x where tenant_id = $1 order by 1::text`, [tenantId])
  const out: Record<string, unknown> = {}
  for (const t of ['tenant_settings', 'resources', 'services', 'service_variants', 'service_addons', 'business_hours',
    'business_exceptions', 'media', 'customers', 'customer_vehicles', 'bookings', 'booking_items', 'resource_occupancies',
    'payments', 'tenant_members']) {
    out[t] = (await q(t)).map((r) => r.r).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))
  }
  out.tenant = (await sql`select to_jsonb(t) - 'updated_at' as r from public.tenants t where id = ${tenantId}`)[0]!.r
  return out
}

describe('tenant publish', () => {
  it('republishing the same config changes nothing', async () => {
    const t = await createTenant()
    const before = await snapshot(t.id)
    const r = (await publish(t.config)) as unknown as Report
    expect(r.created).toEqual([])
    expect(r.updated).toEqual([])
    expect(r.kept_owner_edits).toEqual([])
    expect(r.deleted).toEqual([])
    expect(r.deactivated).toEqual([])
    expect(await snapshot(t.id)).toEqual(before)
  })

  it('republishing never destroys runtime data and keeps owner edits', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const booking = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    await ownerCall(t.ownerId, 'owner_record_payment', t.id, { booking_id: booking.booking.id, method: 'cash', amount_cents: 100000 })
    // Owner edits the price of the service in the cabinet
    await ownerCall(t.ownerId, 'owner_save_service', t.id, { id: t.services.wash, price_cents: 333300 })
    // Config changes: new tagline, a new service, the wash service gets a new description
    const services: Record<string, unknown>[] = (t.config.services as Record<string, unknown>[]).map((s) => ({ ...s, description: 'Новое описание' }))
    services.push({ ...services[0]!, key: 'polish', name: 'Полировка', price_cents: 1500000, description: '' })
    const next = { ...t.config, services, settings: { ...(t.config.settings as object), tagline: 'Новый слоган' } }
    const r = (await publish(next)) as unknown as Report
    expect(r.created).toContain('service:polish')
    expect(r.updated).toContain('settings')
    expect(r.kept_owner_edits).toContain('service:wash')
    const [wash] = await sql`select price_cents, description from public.services where id = ${t.services.wash!}`
    expect(Number(wash!.price_cents)).toBe(333300) // owner's price kept
    expect(wash!.description).toBe('') // config change not applied over an owner edit
    const [counts] = await sql`select
      (select count(*)::int from public.bookings where tenant_id = ${t.id}) b,
      (select count(*)::int from public.payments where tenant_id = ${t.id}) p,
      (select count(*)::int from public.customers where tenant_id = ${t.id}) c,
      (select count(*)::int from public.customer_vehicles where tenant_id = ${t.id}) v,
      (select count(*)::int from public.resource_occupancies where tenant_id = ${t.id} and released_at is null) o`
    expect(counts).toEqual({ b: 1, p: 1, c: 1, v: 1, o: 1 })
    const [bk] = await sql`select price_cents from public.bookings where id = ${booking.booking.id}`
    expect(Number(bk!.price_cents)).toBe(300000)
    // --overwrite applies the config over the owner edit, still without touching bookings
    const r2 = (await publish(next, true)) as unknown as Report
    expect(r2.updated).toContain('service:wash')
    const [wash2] = await sql`select price_cents from public.services where id = ${t.services.wash!}`
    expect(Number(wash2!.price_cents)).toBe(300000)
    const [bk2] = await sql`select price_cents from public.bookings where id = ${booking.booking.id}`
    expect(Number(bk2!.price_cents)).toBe(300000)
  })

  it('services removed from the config are deactivated, not deleted', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    const extra = { ...(t.config.services as Record<string, unknown>[])[0]!, key: 'extra', name: 'Extra' }
    await publish({ ...t.config, services: [...(t.config.services as unknown[]), extra] })
    const r = (await publish({ ...t.config, services: [extra] })) as unknown as Report
    expect(r.deactivated).toContain('service:wash')
    const [wash] = await sql`select active from public.services where id = ${t.services.wash!}`
    expect(wash!.active).toBe(false)
    const n = await count(sql`select count(*)::int n from public.bookings where tenant_id = ${t.id}`)
    expect(n).toBe(1)
  })

  it('a photo or day off the owner deleted stays deleted after republishing', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 20)
    const media = [
      { key: 'hero', kind: 'hero', path: `${t.id}/config/hero.webp`, width: 1600, height: 900, alt: 'Бокс', caption: '', sort_order: 0 },
      { key: 'gallery-1', kind: 'gallery', path: `${t.id}/config/g1.webp`, width: 1200, height: 900, alt: 'Работа', caption: '', sort_order: 1 },
    ]
    const config = { ...t.config, media, exceptions: [{ day, closed: true, opens: null, closes: null, note: 'Праздник' }] }
    await publish(config)
    const [hero] = await sql`select id from public.media where tenant_id = ${t.id} and key = 'hero'`
    const [off] = await sql`select id from public.business_exceptions where tenant_id = ${t.id} and day = ${day}`
    await ownerCall(t.ownerId, 'owner_delete_media', hero!.id)
    await ownerCall(t.ownerId, 'owner_delete_exception', off!.id)

    const r = (await publish(config)) as unknown as Report
    expect(r.created).toEqual([])
    expect(r.kept_owner_edits).toEqual(expect.arrayContaining(['media:hero', `exception:${day}`]))
    const keys = await sql`select key from public.media where tenant_id = ${t.id} order by key`
    expect(keys.map((k) => k.key)).toEqual(['gallery-1'])
    expect(await count(sql`select count(*)::int n from public.business_exceptions where tenant_id = ${t.id}`)).toBe(0)

    // --overwrite restores the config, like it does for edited rows
    const r2 = (await publish(config, true)) as unknown as Report
    expect(r2.created).toEqual(expect.arrayContaining(['media:hero', `exception:${day}`]))
    expect(await count(sql`select count(*)::int n from public.media where tenant_id = ${t.id}`)).toBe(2)
    expect(await count(sql`select count(*)::int n from public.business_exceptions where tenant_id = ${t.id}`)).toBe(1)
  })

  it('publishing tenant B leaves tenant A byte-for-byte unchanged', async () => {
    const a = await createTenant({ slug: 'pub-alpha' })
    const day = await localDay(a.timezone, 3)
    await clientBook(a, { startsAt: await at(a.timezone, day, '10:00') })
    const before = await snapshot(a.id)
    const b = await createTenant({ slug: 'pub-bravo', timezone: 'Asia/Yekaterinburg' })
    await publish({ ...b.config, name: 'Bravo renamed' })
    await clientBook(b, { startsAt: await at(b.timezone, day, '10:00') })
    expect(await snapshot(a.id)).toEqual(before)
  })

  it('a slug that belongs to another tenant is refused', async () => {
    const a = await createTenant({ slug: 'pub-unique' })
    const b = await createTenant()
    await expect(publish({ ...b.config, slug: a.slug })).rejects.toThrow(/tenants_slug_key/)
  })

  it('going live through publish requires the readiness checks', async () => {
    const t = await createTenant({ status: 'demo' })
    const notReady = { ...t.config, status: 'live', settings: { ...(t.config.settings as object), branding: { demoArtwork: true } } }
    await expectCode(publish(notReady), 'NOT_READY')
    const [row] = await sql`select status from public.tenants where id = ${t.id}`
    expect(row!.status).toBe('demo')
  })
})
