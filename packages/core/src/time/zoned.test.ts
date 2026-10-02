import { describe, expect, it } from 'vitest'
import { offsetMinutes, wallClock, zonedIso, zonedToInstant } from './zoned.ts'

describe('zoned time', () => {
  it('converts studio wall clock to instants in fixed-offset zones', () => {
    expect(zonedToInstant('2026-10-02', '10:00', 'Europe/Moscow').toISOString()).toBe('2026-10-02T07:00:00.000Z')
    expect(zonedToInstant('2026-10-02', '10:00', 'Asia/Yekaterinburg').toISOString()).toBe('2026-10-02T05:00:00.000Z')
    expect(zonedIso('2026-10-02', '10:00', 'Asia/Yekaterinburg')).toBe('2026-10-02T10:00:00+05:00')
  })

  it('handles DST: summer, winter, the spring gap and the autumn overlap', () => {
    expect(zonedToInstant('2026-07-01', '12:00', 'Europe/Berlin').toISOString()).toBe('2026-07-01T10:00:00.000Z')
    expect(zonedToInstant('2026-12-01', '12:00', 'Europe/Berlin').toISOString()).toBe('2026-12-01T11:00:00.000Z')
    // 2026-03-29 02:30 does not exist in Berlin: like Postgres, take the instant after the gap.
    expect(zonedToInstant('2026-03-29', '02:30', 'Europe/Berlin').toISOString()).toBe('2026-03-29T01:30:00.000Z')
    // 2026-10-25 02:30 happens twice: PostgreSQL takes the later one (standard time, CET).
    expect(zonedToInstant('2026-10-25', '02:30', 'Europe/Berlin').toISOString()).toBe('2026-10-25T01:30:00.000Z')
    expect(zonedIso('2026-07-01', '12:00', 'Europe/Berlin')).toBe('2026-07-01T12:00:00+02:00')
  })

  it('round-trips through wallClock and reports offsets', () => {
    const i = zonedToInstant('2026-11-15', '23:45', 'America/New_York')
    expect(wallClock(i, 'America/New_York')).toEqual({ day: '2026-11-15', time: '23:45', minutes: 23 * 60 + 45 })
    expect(offsetMinutes(i, 'America/New_York')).toBe(-300)
    expect(offsetMinutes(i, 'Asia/Kolkata')).toBe(330)
  })
})
