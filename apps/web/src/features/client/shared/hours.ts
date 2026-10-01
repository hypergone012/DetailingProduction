import type { Bootstrap } from '@dp/core/api/contracts'
import { addDays, dayParts, today } from '@/lib/format'

function localNow(tz: string): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return { day: today(tz), minutes: h * 60 + m }
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** Working windows of a local day: the exception for that date wins over the weekly hours. */
export function windowsOf(data: Bootstrap, day: string): { opens: string; closes: string }[] {
  const ex = data.exceptions.find((e) => e.day === day)
  if (ex) return ex.closed || !ex.opens || !ex.closes ? [] : [{ opens: ex.opens, closes: ex.closes }]
  const wd = dayParts(day).isoWeekday
  return data.hours.filter((h) => h.weekday === wd).map((h) => ({ opens: h.opens, closes: h.closes }))
}

/** "Открыто до 21:00" / "Откроется завтра в 09:00" in the studio's timezone. */
export function openStatus(data: Bootstrap): { open: boolean; text: string } {
  const tz = data.tenant.timezone
  const now = localNow(tz)
  for (const w of windowsOf(data, now.day)) {
    const o = toMin(w.opens)
    let c = toMin(w.closes)
    if (c <= o) c += 24 * 60
    if (now.minutes >= o && now.minutes < c) return { open: true, text: `Открыто до ${w.closes === '24:00' ? '00:00' : w.closes}` }
    if (now.minutes < o) return { open: false, text: `Откроется сегодня в ${w.opens}` }
  }
  for (let i = 1; i <= 7; i++) {
    const d = addDays(now.day, i)
    const w = windowsOf(data, d)[0]
    if (w) return { open: false, text: `Откроется ${i === 1 ? 'завтра' : dayParts(d).weekday} в ${w.opens}` }
  }
  return { open: false, text: 'Сейчас закрыто' }
}

export const WEEKDAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
