import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { at, clientBook, createTenant, localDay, ownerCall, sql } from './helpers.ts'

afterAll(async () => {
  await sql.end()
})

interface Stats {
  upcoming: { count: number; value_cents: number }
  scheduled: { count: number; value_cents: number }
  completed: { count: number; value_cents: number }
  cancelled: { count: number }
  payments: { received_cents: number; payments_count: number; refunds_cents: number }
  average_ticket_cents: number | null
  utilization: { booked_minutes: number; blocked_minutes: number; available_minutes: number; ratio: number }
  clients: { active: number; new: number; returning: number }
  daily: { day: string; bookings: number }[]
}

describe('payments and revenue', () => {
  it('future booking value is never counted as received revenue', async () => {
    const t = await createTenant()
    const d3 = await localDay(t.timezone, 3)
    const d10 = await localDay(t.timezone, 10)
    const today = await localDay(t.timezone, 0)
    await clientBook(t, { startsAt: await at(t.timezone, d3, '10:00') })
    await clientBook(t, { startsAt: await at(t.timezone, d10, '10:00') })

    let s = await ownerCall<Stats>(t.ownerId, 'owner_stats', t.id, today, d10)
    expect(s.upcoming.count).toBe(2)
    expect(Number(s.upcoming.value_cents)).toBe(600000)
    expect(Number(s.scheduled.value_cents)).toBe(600000)
    expect(Number(s.completed.value_cents)).toBe(0)
    expect(Number(s.payments.received_cents)).toBe(0)
    expect(s.average_ticket_cents).toBeNull()

    // A prepayment today is money received; the booking stays future value.
    const key = randomUUID()
    const p1 = await ownerCall<{ id: string; replayed: boolean }>(t.ownerId, 'owner_record_payment', t.id, {
      method: 'transfer', amount_cents: 100000, idempotency_key: key, note: 'Предоплата',
      booking_id: (await sql`select id from public.bookings where tenant_id = ${t.id} order by starts_at limit 1`)[0]!.id,
    })
    const p2 = await ownerCall<{ id: string; replayed: boolean }>(t.ownerId, 'owner_record_payment', t.id, {
      method: 'transfer', amount_cents: 100000, idempotency_key: key,
    })
    expect(p2.replayed).toBe(true)
    expect(p2.id).toBe(p1.id)
    await ownerCall(t.ownerId, 'owner_record_payment', t.id, { kind: 'refund', method: 'transfer', amount_cents: 25000 })

    s = await ownerCall<Stats>(t.ownerId, 'owner_stats', t.id, today, d10)
    expect(Number(s.payments.received_cents)).toBe(75000)
    expect(s.payments.payments_count).toBe(1)
    expect(Number(s.payments.refunds_cents)).toBe(25000)
    expect(Number(s.upcoming.value_cents)).toBe(600000) // unchanged by payments
    expect(Number(s.completed.value_cents)).toBe(0)
  })

  it('completed work, payments and averages come from SQL over the requested period', async () => {
    const t = await createTenant()
    // Past history through the demo seeder (completed visits with payments).
    await sql`update public.tenants set status = 'demo' where id = ${t.id}`
    await sql`select public.api_admin_seed_demo(${t.id}, ${sql.json({
      customers: [
        { name: 'Олег', phone: '+79161230001', vehicles: [{ make: 'Kia', model: 'K5', body_type: 'sedan' }],
          visits: [
            { service_key: 'wash', days_from_now: -20, local_time: '10:00', status: 'completed', paid_method: 'card' },
            { service_key: 'wash', days_from_now: -5, local_time: '10:00', status: 'completed', paid_method: 'cash' },
          ] },
        { name: 'Мария', phone: '+79161230002', vehicles: [{ make: 'VW', model: 'Tiguan', body_type: 'suv' }],
          visits: [
            { service_key: 'wash', days_from_now: -4, local_time: '12:00', status: 'completed' },
            { service_key: 'wash', days_from_now: -3, local_time: '12:00', status: 'cancelled' },
          ] },
      ],
    })}, false)`
    const from = await localDay(t.timezone, -7)
    const to = await localDay(t.timezone, -1)
    const s = await ownerCall<Stats>(t.ownerId, 'owner_stats', t.id, from, to)
    expect(s.completed.count).toBe(2) // -5 (sedan 3000) and -4 (suv 4000)
    expect(Number(s.completed.value_cents)).toBe(700000)
    expect(s.cancelled.count).toBe(1)
    expect(Number(s.payments.received_cents)).toBe(300000) // only Олег's -5 visit was paid in the period
    expect(Number(s.average_ticket_cents)).toBe(350000)
    expect(s.clients.active).toBe(2)
    expect(s.clients.returning).toBe(1) // Олег had a completed visit before the period
    expect(s.clients.new).toBe(1) // Мария's first visit is inside the period
    expect(s.daily).toHaveLength(7)
    // 2 bays-minutes: one bay, 12 h/day * 7 days available
    expect(s.utilization.available_minutes).toBe(12 * 60 * 7)
    expect(s.utilization.booked_minutes).toBe(90 + 120) // wash 60 + 30 buffer; suv 90 + 30 buffer
    // Seeding is idempotent
    const [again] = await sql`select public.api_admin_seed_demo(${t.id}, ${sql.json({ customers: [] })}, false) as r`
    expect(again!.r).toEqual({ seeded: 0, skipped: 'already_seeded' })
  })

  it('blocks reduce available capacity in utilization', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 2)
    await ownerCall(t.ownerId, 'owner_create_block', t.id, t.resources['bay-1'], await at(t.timezone, day, '09:00'),
      await at(t.timezone, day, '15:00'), 'maintenance', null, null)
    await clientBook(t, { startsAt: await at(t.timezone, day, '15:00') })
    const s = await ownerCall<Stats>(t.ownerId, 'owner_stats', t.id, day, day)
    expect(s.utilization.blocked_minutes).toBe(360)
    expect(s.utilization.booked_minutes).toBe(90)
    expect(Number(s.utilization.ratio)).toBeCloseTo(90 / 360, 4)
  })
})
