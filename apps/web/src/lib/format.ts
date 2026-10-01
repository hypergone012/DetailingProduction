/**
 * Formatting in the STUDIO's timezone and locale (never the device's): a client travelling
 * to another city still sees the studio's wall-clock time.
 */
const cache = new Map<string, Intl.DateTimeFormat>()
function dtf(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(options)
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options)
    cache.set(key, f)
  }
  return f
}

export function money(cents: number, currency: string, locale = 'ru-RU'): string {
  const value = Number(cents) / 100
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value)
}

/** YYYY-MM-DD of an instant in a timezone. */
export function dayKey(date: Date | string, tz: string): string {
  return dtf('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date))
}

export function today(tz: string): string {
  return dayKey(new Date(), tz)
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function time(date: Date | string, tz: string, locale = 'ru-RU'): string {
  return dtf(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(date))
}

export function dateLong(date: Date | string, tz: string, locale = 'ru-RU'): string {
  return dtf(locale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(date))
}

export function dateShort(date: Date | string, tz: string, locale = 'ru-RU'): string {
  return dtf(locale, { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(date))
}

export function dateWithYear(date: Date | string, tz: string, locale = 'ru-RU'): string {
  return dtf(locale, { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(date))
}

/** Parts of a calendar day (YYYY-MM-DD) for day pickers. */
export function dayParts(day: string, locale = 'ru-RU') {
  const d = new Date(`${day}T12:00:00Z`)
  return {
    weekday: dtf(locale, { timeZone: 'UTC', weekday: 'short' }).format(d).replace('.', ''),
    day: d.getUTCDate(),
    month: dtf(locale, { timeZone: 'UTC', month: 'short' }).format(d).replace('.', ''),
    monthLong: dtf(locale, { timeZone: 'UTC', month: 'long' }).format(d),
    isoWeekday: ((d.getUTCDay() + 6) % 7) + 1,
  }
}

/** "сегодня в 10:00", "завтра в 18:30", "пт, 4 окт., 10:00". */
export function when(date: Date | string, tz: string, locale = 'ru-RU'): string {
  const day = dayKey(date, tz)
  const t = time(date, tz, locale)
  const now = today(tz)
  if (day === now) return `сегодня в ${t}`
  if (day === addDays(now, 1)) return `завтра в ${t}`
  if (day === addDays(now, -1)) return `вчера в ${t}`
  return `${dtf(locale, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(date))}, ${t}`
}

export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} мин`
  if (m === 0) return `${h} ч`
  return `${h} ч ${m} мин`
}

/** Calendar span of a booking ("до чт, 6 окт., 12:00" for multi-day work). */
export function span(startIso: string, endIso: string, tz: string, locale = 'ru-RU'): string {
  if (dayKey(startIso, tz) === dayKey(endIso, tz)) return `${time(startIso, tz, locale)}–${time(endIso, tz, locale)}`
  return `${time(startIso, tz, locale)} → ${dtf(locale, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(endIso))}, ${time(endIso, tz, locale)}`
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export function phonePretty(e164: string | null | undefined): string {
  if (!e164) return ''
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164)
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : e164
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Ждёт подтверждения',
  confirmed: 'Подтверждена',
  in_progress: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена',
  no_show: 'Не приехал',
}
