import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, describe, expect, inject, it } from 'vitest'
import {
  count,
  activeOccupancies,
  at,
  availability,
  clientBook,
  createTenant,
  everyDay,
  expectCode,
  localDay,
  ownerCall,
  sql,
} from './helpers.ts'


const iso = (s: string) => new Date(s).toISOString()

afterAll(async () => {
  await sql.end()
})

describe('working hours', () => {
  it('offers slots only inside working hours and refuses bookings outside them', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const { slots } = await availability(t, day)
    expect(slots.length).toBeGreaterThan(0)
    const times = slots.map((s) => s.local_time)
    expect(times[0]).toBe('09:00')
    // 60 min of work must end by 21:00 -> the last start is 20:00
    expect(times.at(-1)).toBe('20:00')
    expect(times.every((x) => x >= '09:00' && x <= '20:00')).toBe(true)

    await expectCode(clientBook(t, { startsAt: await at(t.timezone, day, '08:30') }), 'OUTSIDE_WORKING_HOURS')
    await expectCode(clientBook(t, { startsAt: await at(t.timezone, day, '20:30') }), 'OUTSIDE_WORKING_HOURS')
    // Off the 30-minute grid
    await expectCode(clientBook(t, { startsAt: await at(t.timezone, day, '10:10') }), 'OUTSIDE_WORKING_HOURS')
    const ok = await clientBook(t, { startsAt: await at(t.timezone, day, '20:00') })
    expect(ok.booking.status).toBe('confirmed')
  })

  it('respects minimum notice and booking horizon', async () => {
    const t = await createTenant({ policy: { min_notice_min: 60 * 48, horizon_days: 10 } })
    const tomorrow = await localDay(t.timezone, 1)
    await expectCode(clientBook(t, { startsAt: await at(t.timezone, tomorrow, '12:00') }), 'TOO_SOON')
    const far = await localDay(t.timezone, 20)
    await expectCode(clientBook(t, { startsAt: await at(t.timezone, far, '12:00') }), 'TOO_FAR')
    expect((await availability(t, far)).slots).toHaveLength(0)
  })

  it('supports split shifts and overnight windows', async () => {
    const hours = [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => [
      { weekday, opens: '09:00', closes: '13:00' },
      { weekday, opens: '20:00', closes: '02:00' }, // closes next day
    ])
    const t = await createTenant({ hours })
    const day = await localDay(t.timezone, 4)
    const { slots } = await availability(t, day)
    const times = slots.map((s) => s.local_time)
    expect(times).toContain('12:00')
    expect(times).not.toContain('12:30') // 60 min would cross 13:00
    expect(times).not.toContain('15:00')
    expect(times).toContain('23:30')
    // 00:00-01:00 belongs to the overnight window that started the previous day
    expect(times).toContain('00:00')
    expect(times).toContain('01:00')
    expect(times).not.toContain('01:30')
  })
})

describe('buffer', () => {
  it('blocks the resource until end + buffer', async () => {
    const t = await createTenant() // wash: 60 min + 30 min buffer, one bay
    const day = await localDay(t.timezone, 3)
    const first = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    const [occ] = await activeOccupancies(first.booking.id)
    expect(occ!.during).toContain('07:00:00+00') // 10:00 MSK
    expect(occ!.during).toContain('08:30:00+00') // 11:00 + 30 min buffer
    // 11:00 is after the work but inside the buffer
    await expectCode(clientBook(t, { startsAt: await at(t.timezone, day, '11:00') }), 'SLOT_UNAVAILABLE')
    const times = (await availability(t, day)).slots.map((s) => s.local_time)
    expect(times).not.toContain('11:00')
    expect(times).toContain('11:30')
    const next = await clientBook(t, { startsAt: await at(t.timezone, day, '11:30') })
    expect(next.booking.status).toBe('confirmed')
  })

  it('applies the buffer before the work as well', async () => {
    const t = await createTenant({
      services: [{ key: 'wash', duration_min: 60, price_cents: 100000, buffer_before_min: 30 }],
    })
    const day = await localDay(t.timezone, 3)
    await clientBook(t, { startsAt: await at(t.timezone, day, '12:00') })
    // 11:00-12:00 work would end exactly where the 11:30 buffer of the 12:00 booking starts
    await expectCode(clientBook(t, { startsAt: await at(t.timezone, day, '11:00') }), 'SLOT_UNAVAILABLE')
  })
})

describe('exceptions', () => {
  it('a closed day offers nothing and refuses bookings', async () => {
    const probe = await createTenant()
    const closed = await localDay(probe.timezone, 5)
    const t = await createTenant({ exceptions: [{ day: closed, closed: true, note: 'Праздник' }] })
    expect((await availability(t, closed)).slots).toHaveLength(0)
    await expectCode(clientBook(t, { startsAt: await at(t.timezone, closed, '12:00') }), 'OUTSIDE_WORKING_HOURS')
    // the day after is a normal day
    const next = await localDay(t.timezone, 6)
    expect((await availability(t, next)).slots.length).toBeGreaterThan(0)
  })

  it('a short day uses the exception hours instead of the weekly ones', async () => {
    const probe = await createTenant()
    const short = await localDay(probe.timezone, 5)
    const t = await createTenant({ exceptions: [{ day: short, closed: false, opens: '12:00', closes: '15:00' }] })
    const times = (await availability(t, short)).slots.map((s) => s.local_time)
    expect(times[0]).toBe('12:00')
    expect(times.at(-1)).toBe('14:00')
    await expectCode(clientBook(t, { startsAt: await at(t.timezone, short, '10:00') }), 'OUTSIDE_WORKING_HOURS')
  })
})

describe('timezone', () => {
  it('computes availability in the tenant timezone', async () => {
    const msk = await createTenant({ timezone: 'Europe/Moscow' })
    const ekb = await createTenant({ timezone: 'Asia/Yekaterinburg' })
    const dayMsk = await localDay(msk.timezone, 4)
    const dayEkb = await localDay(ekb.timezone, 4)
    const first = (t: { slots: { starts_at: string }[] }) => iso(t.slots[0]!.starts_at)
    // 09:00 local: UTC+3 -> 06:00Z, UTC+5 -> 04:00Z
    expect(first(await availability(msk, dayMsk))).toBe(`${dayMsk}T06:00:00.000Z`)
    expect(first(await availability(ekb, dayEkb))).toBe(`${dayEkb}T04:00:00.000Z`)
  })

  it('stays on local wall-clock time across a DST change', async () => {
    // Next EU DST change (last Sunday of March or October) at least 2 days from now.
    const lastSunday = (y: number, m: number) => {
      const d = new Date(Date.UTC(y, m + 1, 0))
      d.setUTCDate(d.getUTCDate() - d.getUTCDay())
      return d
    }
    const now = Date.now() + 2 * 86400_000
    const y = new Date().getUTCFullYear()
    const change = [lastSunday(y, 2), lastSunday(y, 9), lastSunday(y + 1, 2), lastSunday(y + 1, 9)].find((d) => d.getTime() > now)!
    const dayAfter = change.toISOString().slice(0, 10)
    const dayBefore = new Date(change.getTime() - 86400_000).toISOString().slice(0, 10)
    const t = await createTenant({ timezone: 'Europe/Berlin', policy: { horizon_days: 365 } })
    const before = iso((await availability(t, dayBefore)).slots[0]!.starts_at)
    const after = iso((await availability(t, dayAfter)).slots[0]!.starts_at)
    const hourBefore = new Date(before).getUTCHours()
    const hourAfter = new Date(after).getUTCHours()
    // 09:00 Berlin is 07:00Z in summer and 08:00Z in winter
    expect(Math.abs(hourAfter - hourBefore)).toBe(1)
    expect([7, 8]).toContain(hourBefore)
    expect([7, 8]).toContain(hourAfter)
    // A booking at 09:00 local on the change day is accepted and stored as that instant
    const b = await clientBook(t, { startsAt: after })
    expect(b.booking.local_start).toBe(`${dayAfter}T09:00`)
  })
})

describe('multi-day', () => {
  const ceramic = {
    key: 'ceramic',
    duration_min: 1560, // 26 h of work
    buffer_after_min: 60,
    price_cents: 6500000,
    multi_day: true,
  }

  it('spreads work over working days and occupies the bay continuously', async () => {
    const t = await createTenant({ services: [ceramic, { key: 'wash', duration_min: 60, price_cents: 100000 }] })
    const day1 = await localDay(t.timezone, 3)
    const day2 = await localDay(t.timezone, 4)
    const day3 = await localDay(t.timezone, 5)
    const b = await clientBook(t, { serviceKey: 'ceramic', startsAt: await at(t.timezone, day1, '10:00') })
    // day1 10-21 (11 h) + day2 9-21 (12 h) + day3 9-12 (3 h) = 26 h
    expect(b.booking.local_end).toBe(`${day3}T12:00`)
    const [occ] = await activeOccupancies(b.booking.id)
    const [range] = await sql<{ lo: Date; hi: Date }[]>`select lower(${occ!.during}::tstzrange) lo, upper(${occ!.during}::tstzrange) hi`
    expect(range!.lo.toISOString()).toBe(await at(t.timezone, day1, '10:00'))
    expect(range!.hi.toISOString()).toBe(await at(t.timezone, day3, '13:00')) // + 60 min buffer
    // The bay is busy overnight and the whole next day
    expect((await availability(t, day2, 1, 'wash')).slots).toHaveLength(0)
    await expectCode(clientBook(t, { startsAt: await at(t.timezone, day2, '15:00') }), 'SLOT_UNAVAILABLE')
    // Free again after the buffer on day 3
    const times = (await availability(t, day3, 1, 'wash')).slots.map((s) => s.local_time)
    expect(times[0]).toBe('13:00')
  })

  it('skips closed days inside a multi-day job', async () => {
    const probe = await createTenant()
    const day1 = await localDay(probe.timezone, 3)
    const closed = await localDay(probe.timezone, 4)
    const day3 = await localDay(probe.timezone, 5)
    const t = await createTenant({ services: [ceramic], exceptions: [{ day: closed, closed: true }] })
    const b = await clientBook(t, { serviceKey: 'ceramic', startsAt: await at(t.timezone, day1, '09:00') })
    // day1 12 h + (closed) + day3 12 h = 24 h < 26 h -> finishes on day 4 at 11:00
    expect(b.booking.local_end).toBe(`${await localDay(t.timezone, 6)}T11:00`)
    expect(day3 < String(b.booking.local_end)).toBe(true)
  })
})

describe('resources', () => {
  it('two compatible resources serve the same slot; the third request fails', async () => {
    const t = await createTenant({
      resources: [
        { key: 'bay-1', name: 'Бокс 1', type: 'detail_bay' },
        { key: 'bay-2', name: 'Бокс 2', type: 'detail_bay' },
        { key: 'wash-1', name: 'Мойка', type: 'wash_bay' },
      ],
    })
    const day = await localDay(t.timezone, 3)
    const start = await at(t.timezone, day, '12:00')
    const a = await clientBook(t, { startsAt: start })
    const b = await clientBook(t, { startsAt: start })
    const resA = (a.booking.resource as { id: string }).id
    const resB = (b.booking.resource as { id: string }).id
    expect(new Set([resA, resB])).toEqual(new Set([t.resources['bay-1'], t.resources['bay-2']]))
    // wash_bay is not a compatible type for this service
    await expectCode(clientBook(t, { startsAt: start }), 'SLOT_UNAVAILABLE')
  })

  it('a manual block conflicts with bookings in both directions', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    await ownerCall(t.ownerId, 'owner_create_block', t.id, t.resources['bay-1'], await at(t.timezone, day, '10:00'),
      await at(t.timezone, day, '12:00'), 'maintenance', 'Замена ламп', null)
    await expectCode(clientBook(t, { startsAt: await at(t.timezone, day, '11:00') }), 'SLOT_UNAVAILABLE')
    const times = (await availability(t, day)).slots.map((s) => s.local_time)
    expect(times).not.toContain('10:00')
    expect(times).not.toContain('11:30')
    expect(times).toContain('12:00')
    const booked = await clientBook(t, { startsAt: await at(t.timezone, day, '15:00') })
    expect(booked.booking.status).toBe('confirmed')
    await expectCode(
      ownerCall(t.ownerId, 'owner_create_block', t.id, t.resources['bay-1'], await at(t.timezone, day, '15:30'),
        await at(t.timezone, day, '17:00'), 'personal', null, null),
      'SLOT_UNAVAILABLE',
    )
    // Releasing the block frees the time
    const [blk] = await sql`select id from public.resource_occupancies where tenant_id = ${t.id} and kind = 'block'`
    await ownerCall(t.ownerId, 'owner_release_block', blk!.id)
    expect((await availability(t, day)).slots.map((s) => s.local_time)).toContain('10:00')
  })
})

describe('concurrency', () => {
  it('two clients racing for the last slot: exactly one wins (blocking path)', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const start = await at(t.timezone, day, '14:00')
    const second = postgres(inject('databaseUrl'), { max: 1, onnotice: () => {} })
    let secondResult: PromiseSettledResult<unknown> | null = null
    // Client A's transaction holds its occupancy uncommitted while B tries the same slot.
    await sql.begin(async (tx) => {
      await clientBook(t, { startsAt: start }, tx)
      const pending = Promise.allSettled([clientBook(t, { startsAt: start }, second)]).then(([r]) => {
        secondResult = r!
      })
      await new Promise((r) => setTimeout(r, 300))
      expect(secondResult).toBeNull() // B is blocked by A's uncommitted occupancy
      void pending
    })
    for (let i = 0; i < 50 && secondResult === null; i++) await new Promise((r) => setTimeout(r, 50))
    await second.end()
    const result = secondResult as PromiseSettledResult<unknown> | null
    expect(result?.status).toBe('rejected')
    expect(((result as PromiseRejectedResult).reason as Error).message).toBe('SLOT_UNAVAILABLE')
    const n = await count(sql`select count(*)::int as n from public.bookings where tenant_id = ${t.id}`)
    expect(n).toBe(1)
  })

  it('a burst of 12 parallel requests for one slot creates one booking per free resource', async () => {
    const t = await createTenant({
      resources: [
        { key: 'bay-1', name: 'Бокс 1', type: 'detail_bay' },
        { key: 'bay-2', name: 'Бокс 2', type: 'detail_bay' },
      ],
    })
    const day = await localDay(t.timezone, 3)
    const start = await at(t.timezone, day, '16:00')
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => clientBook(t, { startsAt: start })))
    const ok = results.filter((r) => r.status === 'fulfilled')
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(ok).toHaveLength(2)
    expect(failed.every((r) => (r.reason as Error).message === 'SLOT_UNAVAILABLE')).toBe(true)
    const n = await count(sql`select count(*)::int as n from public.resource_occupancies
                              where tenant_id = ${t.id} and released_at is null`)
    expect(n).toBe(2)
  })

  it('the exclusion constraint holds even for direct inserts that bypass the engine', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    let error: Error | null = null
    try {
      await sql`insert into public.resource_occupancies (tenant_id, resource_id, kind, block_reason, during)
                values (${t.id}, ${t.resources['bay-1']!}, 'block', 'other',
                        tstzrange(${await at(t.timezone, day, '10:30')}::timestamptz, ${await at(t.timezone, day, '10:45')}::timestamptz))`
    } catch (e) {
      error = e as Error
    }
    expect((error as unknown as { code: string }).code).toBe('23P01')
    expect(b.booking.id).toBeTruthy()
  })
})

describe('pricing and add-ons', () => {
  it('prices by body type and add-ons on the server', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const sedan = await clientBook(t, { startsAt: await at(t.timezone, day, '09:00') })
    expect(Number(sedan.booking.price_cents)).toBe(300000)
    const suv = await clientBook(t, {
      startsAt: await at(t.timezone, day, '12:00'),
      vehicle: { make: 'Toyota', model: 'LC300', body_type: 'suv' },
      addonKeys: ['wheels'],
    })
    // suv variant 4000 + wheels 1500; 90 + 30 min of work
    expect(Number(suv.booking.price_cents)).toBe(550000)
    expect(suv.booking.work_minutes).toBe(120)
    expect((suv.booking.items as unknown[]).length).toBe(2)
  })

  it('rejects add-ons of another tenant', async () => {
    const a = await createTenant()
    const b = await createTenant()
    const day = await localDay(a.timezone, 3)
    await expectCode(
      clientBook({ ...a, addons: { wheels: b.addons.wheels! } }, { startsAt: await at(a.timezone, day, '13:00'), addonKeys: ['wheels'] }),
      'ADDON_NOT_FOUND',
    )
  })

  it('never accepts a service id from another tenant', async () => {
    const a = await createTenant()
    const b = await createTenant()
    const day = await localDay(a.timezone, 3)
    await expectCode(
      clientBook({ ...a, services: { wash: b.services.wash! } }, { startsAt: await at(a.timezone, day, '10:00') }),
      'SERVICE_NOT_FOUND',
    )
  })
})

describe('owner booking', () => {
  it('owner can book outside hours on a chosen lane but never overlap', async () => {
    const t = await createTenant({ hours: everyDay('09:00', '18:00') })
    const day = await localDay(t.timezone, 3)
    const r = await ownerCall<{ id: string; status: string }>(t.ownerId, 'owner_create_booking', t.id, {
      customer: { name: 'Пётр', phone: '+79160000001' },
      vehicle: { make: 'Audi', model: 'A6', body_type: 'sedan' },
      service_id: t.services.wash,
      starts_at: await at(t.timezone, day, '19:00'),
      resource_id: t.resources['bay-1'],
      allow_outside_hours: true,
    })
    expect(r.status).toBe('confirmed')
    await expectCode(
      ownerCall(t.ownerId, 'owner_create_booking', t.id, {
        customer: { name: 'Анна', phone: '+79160000002' },
        service_id: t.services.wash,
        starts_at: await at(t.timezone, day, '19:30'),
        allow_outside_hours: true,
      }),
      'SLOT_UNAVAILABLE',
    )
    // without the flag, hours apply to the owner too
    await expectCode(
      ownerCall(t.ownerId, 'owner_create_booking', t.id, {
        customer: { name: 'Анна', phone: '+79160000002' },
        service_id: t.services.wash,
        starts_at: await at(t.timezone, day, '07:00'),
      }),
      'OUTSIDE_WORKING_HOURS',
    )
    expect(randomUUID()).toBeTruthy()
  })
})
