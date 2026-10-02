import { afterAll, describe, expect, it } from 'vitest'
import { at, clientBook, createTenant, createUser, expectCode, localDay, ownerCall, sql } from './helpers.ts'

afterAll(async () => {
  await sql.end()
})

interface CalendarItem {
  id: string
  kind: 'booking' | 'block'
  resource_id: string
  starts_at: string
  ends_at: string
  booking: { id: string; status: string; customer: { name: string }; vehicle: { make: string } | null } | null
  block: { reason: string; title: string | null } | null
}
interface Calendar {
  timezone: string
  resources: { id: string; key: string }[]
  windows: { starts_at: string; ends_at: string }[]
  items: CalendarItem[]
}

const twoBays = [
  { key: 'bay-1', name: 'Бокс 1', type: 'detail_bay' },
  { key: 'bay-2', name: 'Бокс 2', type: 'detail_bay' },
]

describe('owner_calendar', () => {
  it('returns lanes, working windows, bookings in both lanes and blocks; released occupancies are gone', async () => {
    const t = await createTenant({ resources: twoBays })
    const day = await localDay(t.timezone, 3)
    const first = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00'), name: 'Анна' })
    const second = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00'), name: 'Борис' })
    const cancelled = await clientBook(t, { startsAt: await at(t.timezone, day, '14:00') })
    await ownerCall(t.ownerId, 'owner_cancel_booking', cancelled.booking.id, 'тест')
    await ownerCall(t.ownerId, 'owner_create_block', t.id, t.resources['bay-2'], await at(t.timezone, day, '17:00'),
      await at(t.timezone, day, '18:00'), 'maintenance', 'Лампы', null)

    const cal = await ownerCall<Calendar>(t.ownerId, 'owner_calendar', t.id, day, 1)
    expect(cal.timezone).toBe(t.timezone)
    expect(cal.resources.map((r) => r.key)).toEqual(['bay-1', 'bay-2'])
    expect(cal.windows).toEqual([{ starts_at: expect.any(String), ends_at: expect.any(String) }])
    expect(new Date(cal.windows[0]!.starts_at).toISOString()).toBe(await at(t.timezone, day, '09:00'))
    expect(new Date(cal.windows[0]!.ends_at).toISOString()).toBe(await at(t.timezone, day, '21:00'))

    const bookings = cal.items.filter((i) => i.kind === 'booking')
    expect(bookings.map((b) => b.booking!.id).sort()).toEqual([first.booking.id, second.booking.id].sort())
    expect(new Set(bookings.map((b) => b.resource_id)).size).toBe(2) // two lanes at the same time
    expect(bookings.map((b) => b.booking!.customer.name).sort()).toEqual(['Анна', 'Борис'])
    expect(bookings[0]!.booking!.vehicle?.make).toBe('BMW')
    const block = cal.items.find((i) => i.kind === 'block')!
    expect(block.resource_id).toBe(t.resources['bay-2'])
    expect(block.block).toEqual({ reason: 'maintenance', title: 'Лампы', note: null })
    // The occupancy includes the 30 min buffer after the 60 min wash.
    expect(new Date(bookings[0]!.ends_at).toISOString()).toBe(await at(t.timezone, day, '11:30'))
  })

  it('a multi-day range returns one window per working day and rejects silly ranges', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const cal = await ownerCall<Calendar>(t.ownerId, 'owner_calendar', t.id, day, 7)
    expect(cal.windows).toHaveLength(7)
    await expectCode(ownerCall(t.ownerId, 'owner_calendar', t.id, day, 0), 'INVALID_RANGE')
    await expectCode(ownerCall(t.ownerId, 'owner_calendar', t.id, day, 60), 'INVALID_RANGE')
  })

  it('is tenant-isolated', async () => {
    const a = await createTenant()
    const b = await createTenant()
    const day = await localDay(b.timezone, 3)
    const bookingB = await clientBook(b, { startsAt: await at(b.timezone, day, '10:00') })
    await expectCode(ownerCall(a.ownerId, 'owner_calendar', b.id, day, 1), 'NOT_FOUND')
    await expectCode(ownerCall(a.ownerId, 'owner_booking', bookingB.booking.id), 'NOT_FOUND')
    const stranger = await createUser()
    await expectCode(ownerCall(stranger, 'owner_calendar', b.id, day, 1), 'NOT_FOUND')
  })
})

describe('owner_booking', () => {
  it('returns history, photos and payments for managers; staff see no money', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    await ownerCall(t.ownerId, 'owner_update_booking', b.booking.id, { price_cents: 250000, price_reason: 'Скидка' })
    await ownerCall(t.ownerId, 'owner_record_payment', t.id, { booking_id: b.booking.id, method: 'card', amount_cents: 100000 })

    const full = await ownerCall<Record<string, unknown> & { events: { event: string }[]; payments: unknown[]; paid_cents: number; items: { kind: string }[] }>(
      t.ownerId, 'owner_booking', b.booking.id)
    expect(full.events.map((e) => e.event)).toEqual(['created', 'price_changed'])
    expect(full.items.map((i) => i.kind)).toEqual(['service', 'adjustment'])
    expect(full.payments).toHaveLength(1)
    expect(full.paid_cents).toBe(100000)
    expect(full.money_visible).toBe(true)
    expect((full.customer as { name: string }).name).toBeTruthy()

    const staff = await createUser()
    await sql`insert into public.tenant_members (tenant_id, user_id, role) values (${t.id}, ${staff}, 'staff')`
    const limited = await ownerCall<Record<string, unknown>>(staff, 'owner_booking', b.booking.id)
    expect(limited.money_visible).toBe(false)
    expect(limited.payments).toBeNull()
    expect('paid_cents' in limited).toBe(false)
  })
})

describe('owner_create_booking idempotency', () => {
  it('a retried request with the same key returns the same booking; another payload with it is rejected', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 4)
    const payload = {
      customer: { name: 'Позвонил по телефону', phone: '+79160001122' },
      vehicle: { make: 'Kia', model: 'Rio', body_type: 'sedan' },
      service_id: t.services.wash,
      addon_ids: [],
      starts_at: await at(t.timezone, day, '12:00'),
      idempotency_key: 'owner-key-0001',
    }
    const first = await ownerCall<{ id: string; replayed: boolean }>(t.ownerId, 'owner_create_booking', t.id, payload)
    const again = await ownerCall<{ id: string; replayed: boolean }>(t.ownerId, 'owner_create_booking', t.id, payload)
    expect(first.replayed).toBe(false)
    expect(again.replayed).toBe(true)
    expect(again.id).toBe(first.id)
    const [{ n }] = (await sql`select count(*)::int as n from public.bookings where tenant_id = ${t.id}`) as unknown as [{ n: number }]
    expect(n).toBe(1)
    await expectCode(
      ownerCall(t.ownerId, 'owner_create_booking', t.id, { ...payload, starts_at: await at(t.timezone, day, '15:00') }),
      'IDEMPOTENCY_CONFLICT',
    )
    // Without a key every call creates a booking (the old contract still works).
    const { idempotency_key: _drop, ...noKey } = payload
    const other = await ownerCall<{ id: string }>(t.ownerId, 'owner_create_booking', t.id, { ...noKey, starts_at: await at(t.timezone, day, '16:00') })
    expect(other.id).not.toBe(first.id)
  })
})
