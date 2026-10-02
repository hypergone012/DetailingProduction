/** Formatting in the STUDIO's timezone (the assistant speaks studio wall-clock time). */
import { wallClock } from '../_vendor/core/time/zoned.ts'

const cache = new Map<string, Intl.DateTimeFormat>()
function dtf(tz: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(options)
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, ...options })
    cache.set(key, f)
  }
  return f
}

export function formatMoney(cents: number, currency: string): string {
  const value = Number(cents) / 100
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value)
}

/**
 *   full (default) — "пт, 3 окт., 10:00"
 *   time           — "10:00"
 *   date           — "3 октября"
 *   day            — "2026-10-03" (studio-local calendar day)
 */
export function labelWhen(iso: string, tz: string, mode: 'full' | 'time' | 'date' | 'day' = 'full'): string {
  const d = new Date(iso)
  if (mode === 'day') return wallClock(d, tz).day
  if (mode === 'time') return wallClock(d, tz).time
  if (mode === 'date') return dtf(tz, { day: 'numeric', month: 'long' }).format(d)
  return `${dtf(tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(d)}, ${wallClock(d, tz).time}`
}

export function localMinutes(iso: string, tz: string): number {
  return wallClock(new Date(iso), tz).minutes
}

export function localToday(tz: string, now = new Date()): { day: string; time: string } {
  const w = wallClock(now, tz)
  return { day: w.day, time: w.time }
}
