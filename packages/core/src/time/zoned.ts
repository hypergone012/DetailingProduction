/**
 * Wall-clock time of a studio <-> instants, without a date library. Used where a person
 * picks "10:00 on 2 October" in the studio's timezone (owner calendar, assistant tools):
 * the server always receives an absolute instant with an offset.
 */
const cache = new Map<string, Intl.DateTimeFormat>()
function parts(tz: string): Intl.DateTimeFormat {
  let f = cache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    cache.set(tz, f)
  }
  return f
}

/** Wall clock of an instant in a timezone. */
export function wallClock(instant: Date, tz: string): { day: string; time: string; minutes: number } {
  const p = Object.fromEntries(parts(tz).formatToParts(instant).map((x) => [x.type, x.value]))
  const day = `${p.year}-${p.month}-${p.day}`
  const time = `${p.hour}:${p.minute}`
  return { day, time, minutes: Number(p.hour) * 60 + Number(p.minute) }
}

/** Offset of a timezone at an instant, in minutes east of UTC. */
export function offsetMinutes(instant: Date, tz: string): number {
  const p = Object.fromEntries(parts(tz).formatToParts(instant).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000)
}

/**
 * Instant of a wall-clock time in a timezone. A time that does not exist (spring-forward
 * gap) resolves to the instant after the gap and an ambiguous time (fall-back) to the later,
 * standard-time occurrence — the same results as PostgreSQL's `timestamp AT TIME ZONE`
 * (checked against it in the tests' expectations).
 */
export function zonedToInstant(day: string, time: string, tz: string): Date {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number]
  const [h, mi] = time.split(':').map(Number) as [number, number]
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  const first = wall - offsetMinutes(new Date(wall), tz) * 60000
  const second = wall - offsetMinutes(new Date(first), tz) * 60000
  if (first === second) return new Date(first)
  // Offsets disagree around a transition: take the later candidate whose wall clock matches.
  const target = `${day} ${time}`
  for (const c of [Math.max(first, second), Math.min(first, second)]) {
    const w = wallClock(new Date(c), tz)
    if (`${w.day} ${w.time}` === target) return new Date(c)
  }
  return new Date(Math.max(first, second))
}

/** ISO string with the timezone's own offset, e.g. 2026-10-02T10:00:00+03:00. */
export function zonedIso(day: string, time: string, tz: string): string {
  const instant = zonedToInstant(day, time, tz)
  const off = offsetMinutes(instant, tz)
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  const w = wallClock(instant, tz)
  return `${w.day}T${w.time}:00${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}
