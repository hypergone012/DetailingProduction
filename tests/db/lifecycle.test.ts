import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import {
  count,
  activeOccupancies,
  asService,
  at,
  availability,
  clientBook,
  createTenant,
  expectCode,
  localDay,
  ownerCall,
  sha256,
  sql,
  type Tenant,
} from './helpers.ts'


afterAll(async () => {
  await sql.end()
})

async function reschedule(t: Tenant, token: string, startsAt: string, key = randomUUID(), hash = `h-${startsAt}`) {
  return asService(async (tx) => {
    const [r] = await tx`select public.api_public_reschedule(${t.slug}, ${key}, ${sha256(hash).toString('hex')}, ${sha256(token)}, ${null}, ${null}, ${startsAt}) as r`
    return r!.r as { booking: { id: string; starts_at: string; version: number; local_start: string }; replayed: boolean }
  })
}

async function cancel(t: Tenant, token: string) {
  return asService(async (tx) => {
    const [r] = await tx`select public.api_public_cancel(${t.slug}, ${sha256(token)}, ${null}, ${null}, ${'передумал'}) as r`
    return r!.r as { booking: { status: string } }
  })
}

describe('reschedule', () => {
  it('moves atomically: new occupancy active, old released, history and outbox written', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    const moved = await reschedule(t, b.token, await at(t.timezone, day, '15:00'))
    expect(moved.booking.local_start).toBe(`${day}T15:00`)
    expect(moved.booking.version).toBe(2)
    const occ = await activeOccupancies(b.booking.id)
    expect(occ).toHaveLength(2)
    expect(occ.filter((o) => o.released_at === null)).toHaveLength(1)
    expect(occ[0]!.released_at).not.toBeNull() // the original
    const times = (await availability(t, day)).slots.map((s) => s.local_time)
    expect(times).toContain('10:00') // freed
    expect(times).not.toContain('15:00')
    const events = await sql`select event, data from public.booking_events where booking_id = ${b.booking.id} order by id`
    expect(events.map((e) => e.event)).toEqual(['created', 'moved'])
    const jobs = await sql`select event, audience from public.notification_jobs where booking_id = ${b.booking.id} and event = 'booking.moved'`
    expect(jobs).toHaveLength(2)
  })

  it('can shift by 30 minutes into its own previous interval', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    const moved = await reschedule(t, b.token, await at(t.timezone, day, '10:30'))
    expect(moved.booking.local_start).toBe(`${day}T10:30`)
  })

  it('a failed move keeps the original booking and occupancy untouched', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const mine = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    await clientBook(t, { startsAt: await at(t.timezone, day, '15:00') })
    const before = await activeOccupancies(mine.booking.id)
    await expectCode(reschedule(t, mine.token, await at(t.timezone, day, '15:00')), 'SLOT_UNAVAILABLE')
    const after = await activeOccupancies(mine.booking.id)
    expect(after).toEqual(before)
    expect(after.filter((o) => o.released_at === null)).toHaveLength(1)
    const [row] = await sql`select starts_at, version, status from public.bookings where id = ${mine.booking.id}`
    expect(row!.starts_at.toISOString()).toBe(await at(t.timezone, day, '10:00'))
    expect(row!.version).toBe(1)
    expect(row!.status).toBe('confirmed')
    const n = await count(sql`select count(*)::int n from public.notification_jobs where booking_id = ${mine.booking.id} and event = 'booking.moved'`)
    expect(n).toBe(0)
    // and the original slot is still taken
    expect((await availability(t, day)).slots.map((s) => s.local_time)).not.toContain('10:00')
  })

  it('a move outside working hours fails and keeps the booking', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    await expectCode(reschedule(t, b.token, await at(t.timezone, day, '22:00')), 'OUTSIDE_WORKING_HOURS')
    expect((await activeOccupancies(b.booking.id)).filter((o) => !o.released_at)).toHaveLength(1)
  })

  it('reschedule is idempotent per key and rejects key reuse for another target', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    const key = randomUUID()
    const target = await at(t.timezone, day, '12:00')
    const first = await reschedule(t, b.token, target, key, 'same')
    const again = await reschedule(t, b.token, target, key, 'same')
    expect(again.replayed).toBe(true)
    expect(again.booking.version).toBe(first.booking.version)
    await expectCode(reschedule(t, b.token, await at(t.timezone, day, '13:00'), key, 'different'), 'IDEMPOTENCY_CONFLICT')
  })

  it('owner can move a booking to another lane; the client cannot after the cutoff', async () => {
    const t = await createTenant({
      resources: [
        { key: 'bay-1', name: 'Бокс 1', type: 'detail_bay' },
        { key: 'bay-2', name: 'Бокс 2', type: 'detail_bay' },
      ],
      policy: { cancel_cutoff_hours: 96 },
    })
    // Two days ahead is always inside a 96 h cutoff and outside the 60 min notice.
    const day = await localDay(t.timezone, 2)
    const start = await at(t.timezone, day, '12:00')
    const b = await clientBook(t, { startsAt: start })
    expect(b.booking.can_modify).toBe(false)
    await expectCode(reschedule(t, b.token, await at(t.timezone, await localDay(t.timezone, 6), '12:00')), 'CUTOFF_PASSED')
    await expectCode(cancel(t, b.token), 'CUTOFF_PASSED')
    const current = (b.booking.resource as { id: string }).id
    const lane = current === t.resources['bay-1'] ? t.resources['bay-2']! : t.resources['bay-1']!
    const moved = await ownerCall<{ resource: { id: string } }>(t.ownerId, 'owner_reschedule_booking', b.booking.id, start, lane, false)
    expect(moved.resource.id).toBe(lane)
  })
})

describe('cancel', () => {
  it('releases the resource, records history, enqueues jobs and is idempotent', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    const r = await cancel(t, b.token)
    expect(r.booking.status).toBe('cancelled')
    expect((await activeOccupancies(b.booking.id)).every((o) => o.released_at !== null)).toBe(true)
    expect((await availability(t, day)).slots.map((s) => s.local_time)).toContain('10:00')
    const again = await cancel(t, b.token)
    expect(again.booking.status).toBe('cancelled')
    const jobs = await sql`select audience from public.notification_jobs where booking_id = ${b.booking.id} and event = 'booking.cancelled'`
    expect(jobs).toHaveLength(2) // owner + client, not duplicated by the second call
    const events = await sql`select event from public.booking_events where booking_id = ${b.booking.id} and event = 'cancelled'`
    expect(events).toHaveLength(1)
    const [row] = await sql`select cancelled_by, cancel_reason from public.bookings where id = ${b.booking.id}`
    expect(row).toEqual({ cancelled_by: 'client', cancel_reason: 'передумал' })
  })
})

describe('idempotent creation', () => {
  it('a retried request returns the same booking and creates nothing new', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const key = randomUUID()
    const token = 'retry-token-' + randomUUID()
    const profileKey = 'retry-profile-' + randomUUID()
    const opts = { startsAt: await at(t.timezone, day, '10:00'), idempotencyKey: key, requestHash: 'same-request', token, profileKey, createProfile: true, phone: '+79161112233' }
    const first = await clientBook(t, opts)
    const second = await clientBook(t, opts)
    expect(second.replayed).toBe(true)
    expect(second.booking.id).toBe(first.booking.id)
    expect(second.profile_id).toBe(first.profile_id)
    const [counts] = await sql`select
      (select count(*)::int from public.bookings where tenant_id = ${t.id}) as bookings,
      (select count(*)::int from public.booking_access_tokens where tenant_id = ${t.id}) as tokens,
      (select count(*)::int from public.client_profiles where tenant_id = ${t.id}) as profiles,
      (select count(*)::int from public.customer_vehicles where tenant_id = ${t.id}) as vehicles,
      (select count(*)::int from public.notification_jobs where tenant_id = ${t.id} and event = 'booking.created') as jobs`
    expect(counts).toEqual({ bookings: 1, tokens: 1, profiles: 1, vehicles: 1, jobs: 2 })
  })

  it('the same key with a different payload is rejected', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const key = randomUUID()
    await clientBook(t, { startsAt: await at(t.timezone, day, '10:00'), idempotencyKey: key, requestHash: 'a' })
    await expectCode(clientBook(t, { startsAt: await at(t.timezone, day, '12:00'), idempotencyKey: key, requestHash: 'b' }), 'IDEMPOTENCY_CONFLICT')
  })

  it('concurrent duplicates with one key create one booking even with free capacity', async () => {
    const t = await createTenant({
      resources: [
        { key: 'bay-1', name: 'Бокс 1', type: 'detail_bay' },
        { key: 'bay-2', name: 'Бокс 2', type: 'detail_bay' },
        { key: 'bay-3', name: 'Бокс 3', type: 'detail_bay' },
      ],
    })
    const day = await localDay(t.timezone, 3)
    const opts = {
      startsAt: await at(t.timezone, day, '10:00'),
      idempotencyKey: randomUUID(),
      requestHash: 'dup',
      token: 'tok-' + randomUUID(),
      profileKey: 'pk-' + randomUUID(),
      createProfile: true,
      phone: '+79165550000',
    }
    const results = await Promise.all(Array.from({ length: 6 }, () => clientBook(t, opts)))
    expect(new Set(results.map((r) => r.booking.id)).size).toBe(1)
    expect(results.filter((r) => !r.replayed)).toHaveLength(1)
    const n = await count(sql`select count(*)::int n from public.bookings where tenant_id = ${t.id}`)
    expect(n).toBe(1)
  })

  it('a failed attempt does not burn the key: the retry can succeed later', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const blocker = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    const key = randomUUID()
    const opts = { startsAt: await at(t.timezone, day, '10:00'), idempotencyKey: key, requestHash: 'x' }
    await expectCode(clientBook(t, opts), 'SLOT_UNAVAILABLE')
    await cancel(t, blocker.token)
    const ok = await clientBook(t, opts)
    expect(ok.replayed).toBe(false)
  })
})

describe('historical price', () => {
  it('changing the service price never rewrites existing bookings', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const old = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    expect(Number(old.booking.price_cents)).toBe(300000)
    await ownerCall(t.ownerId, 'owner_save_service', t.id, { id: t.services.wash, price_cents: 450000, duration_min: 90 })
    const [row] = await sql`select price_cents, work_minutes, ends_at from public.bookings where id = ${old.booking.id}`
    expect(Number(row!.price_cents)).toBe(300000)
    expect(row!.work_minutes).toBe(60)
    const items = await sql`select price_cents from public.booking_items where booking_id = ${old.booking.id}`
    expect(items.map((i) => Number(i.price_cents))).toEqual([300000])
    const fresh = await clientBook(t, { startsAt: await at(t.timezone, day, '14:00') })
    expect(Number(fresh.booking.price_cents)).toBe(450000)
    expect(fresh.booking.work_minutes).toBe(90)
    // a reschedule keeps the snapshot price and duration
    const r = await ownerCall<{ price_cents: number; work_minutes: number }>(t.ownerId, 'owner_reschedule_booking', old.booking.id, await at(t.timezone, day, '17:00'), null, false)
    expect(Number(r.price_cents)).toBe(300000)
    expect(r.work_minutes).toBe(60)
  })

  it('an owner price adjustment is recorded as a separate line', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    const r = await ownerCall<{ price_cents: number; items: { kind: string; price_cents: number }[] }>(
      t.ownerId, 'owner_update_booking', b.booking.id, { price_cents: 350000, price_reason: 'Сильное загрязнение' })
    expect(Number(r.price_cents)).toBe(350000)
    expect(r.items.map((i) => [i.kind, Number(i.price_cents)])).toEqual([['service', 300000], ['adjustment', 50000]])
  })
})

describe('status machine', () => {
  it('allows only valid transitions', async () => {
    const t = await createTenant({ policy: { requires_confirmation: true } })
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    expect(b.booking.status).toBe('pending')
    await expectCode(ownerCall(t.ownerId, 'owner_set_booking_status', b.booking.id, 'completed'), 'INVALID_TRANSITION')
    const c = await ownerCall<{ status: string }>(t.ownerId, 'owner_set_booking_status', b.booking.id, 'confirmed')
    expect(c.status).toBe('confirmed')
    // 3 days ahead: cannot be started yet
    await expectCode(ownerCall(t.ownerId, 'owner_set_booking_status', b.booking.id, 'in_progress'), 'TOO_EARLY')
    const jobs = await sql`select event from public.notification_jobs where booking_id = ${b.booking.id} order by created_at`
    expect(jobs.map((j) => j.event)).toContain('booking.confirmed')
  })

  it('limits active bookings per customer', async () => {
    const t = await createTenant({ policy: { max_active_bookings_per_phone: 2 } })
    const day = await localDay(t.timezone, 3)
    const phone = '+79167770000'
    await clientBook(t, { startsAt: await at(t.timezone, day, '09:00'), phone })
    await clientBook(t, { startsAt: await at(t.timezone, day, '11:00'), phone })
    await expectCode(clientBook(t, { startsAt: await at(t.timezone, day, '13:00'), phone }), 'TOO_MANY_ACTIVE_BOOKINGS')
  })
})
