/**
 * Russian date/time phrases -> studio-local day and time. Pure: `today` (YYYY-MM-DD in the
 * studio timezone) is an input, so the same text always resolves the same way in tests.
 */
export type DayPart = 'morning' | 'day' | 'evening'

export interface WhenHint {
  day: string | null
  time: string | null
  part: DayPart | null
}

/** Whole-word regexp for Cyrillic text (`\b` only knows ASCII word characters). */
export function word(source: string, flags = ''): RegExp {
  return new RegExp(`(?<![\\p{L}\\d])(?:${source})(?![\\p{L}\\d])`, `u${flags}`)
}

const MONTHS: [RegExp, number][] = [
  [/^янв/, 1], [/^фев/, 2], [/^мар/, 3], [/^апр/, 4], [/^ма[йя]/, 5], [/^июн/, 6],
  [/^июл/, 7], [/^авг/, 8], [/^сен/, 9], [/^окт/, 10], [/^ноя/, 11], [/^дек/, 12],
]

// isoWeekday: Monday = 1 ... Sunday = 7
const WEEKDAYS: [RegExp, number][] = [
  [word('понедельник\\p{L}*|пн'), 1],
  [word('вторник\\p{L}*|вт'), 2],
  [word('сред[ау]|ср'), 3],
  [word('четверг\\p{L}*|чт'), 4],
  [word('пятниц[аеуы]|пт'), 5],
  [word('суббот[аеуы]|сб'), 6],
  [word('воскресень[еяю]|вс'), 7],
]

const WORD_NUMBERS: Record<string, number> = {
  один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„!?,;()]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function isoWeekday(day: string): number {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay()
  return wd === 0 ? 7 : wd
}

const pad = (n: number) => String(n).padStart(2, '0')

function validDay(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}

/** The next occurrence (today included) of a calendar date written without a year. */
function nextDate(today: string, month: number, day: number): string | null {
  const year = Number(today.slice(0, 4))
  const thisYear = validDay(year, month, day)
  if (thisYear && thisYear >= today) return thisYear
  return validDay(year + 1, month, day)
}

export function parseDay(text: string, today: string): string | null {
  const t = normalizeText(text)
  if (word('послезавтра').test(t)) return addDaysIso(today, 2)
  if (word('завтра').test(t)) return addDaysIso(today, 1)
  if (word('сегодня').test(t)) return today
  const inDays = word('через (\\d{1,2}|\\p{L}+) (?:день|дня|дней)').exec(t)
  if (inDays) {
    const n = /^\d+$/.test(inDays[1]!) ? Number(inDays[1]) : WORD_NUMBERS[inDays[1]!]
    if (n) return addDaysIso(today, n)
  }
  if (word('через неделю').test(t)) return addDaysIso(today, 7)
  // 15.10 / 15.10.2026 / 15/10 — not a time like 10.30 after "в".
  const numeric = /(?<![\p{L}\d.:])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d:])/u.exec(t)
  if (numeric && !word(`(?:в|к|около) ${numeric[0].replace('.', '\\.')}`).test(t)) {
    const d = Number(numeric[1])
    const m = Number(numeric[2])
    if (m >= 1 && m <= 12) {
      if (numeric[3]) {
        const y = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])
        return validDay(y, m, d)
      }
      return nextDate(today, m, d)
    }
  }
  // 15 октября
  const named = /(?<![\p{L}\d])(\d{1,2}) (\p{L}+)/u.exec(t)
  if (named) {
    const month = MONTHS.find(([re]) => re.test(named[2]!))?.[1]
    if (month) return nextDate(today, month, Number(named[1]))
  }
  if (word('на выходных|в выходные').test(t)) {
    const wd = isoWeekday(today)
    return addDaysIso(today, wd >= 6 ? 0 : 6 - wd)
  }
  for (const [re, target] of WEEKDAYS) {
    if (re.test(t)) {
      const wd = isoWeekday(today)
      let diff = (target - wd + 7) % 7
      // "в следующую пятницу": the one in the coming week, not this week's.
      if (word('следующ\\p{L}*').test(t) && target > wd) diff += 7
      return addDaysIso(today, diff)
    }
  }
  return null
}

export function parseTime(text: string): { time: string | null; part: DayPart | null } {
  const t = normalizeText(text)
  const hm = /(?<![\p{L}\d.])(\d{1,2}):(\d{2})(?!\d)/u.exec(t) ?? word('(?:в|к|около) (\\d{1,2})\\.(\\d{2})').exec(t)
  if (hm) {
    const h = Number(hm[1])
    const m = Number(hm[2])
    if (h <= 23 && m <= 59) return { time: `${pad(h)}:${pad(m)}`, part: null }
  }
  const hOnly = word('(?:в|к|около|на) (\\d{1,2})(?: ?(?:ч|час|часа|часов))?(?: (утра|дня|вечера))?').exec(t)
  if (hOnly && !/[./]\d/.test(t.slice((hOnly.index ?? 0) + hOnly[0].length, (hOnly.index ?? 0) + hOnly[0].length + 2))) {
    let h = Number(hOnly[1])
    const suffix = hOnly[2]
    if ((suffix === 'дня' || suffix === 'вечера') && h < 12) h += 12
    // "в 3" without a suffix in a detailing studio means 15:00, not 03:00.
    if (!suffix && h >= 1 && h <= 7) h += 12
    if (h >= 0 && h <= 23) return { time: `${pad(h)}:00`, part: null }
  }
  if (word('утр(?:ом|а|у)').test(t)) return { time: null, part: 'morning' }
  if (word('днем|в обед|после обеда').test(t)) return { time: null, part: 'day' }
  if (word('вечер(?:ом|а|у)?').test(t)) return { time: null, part: 'evening' }
  return { time: null, part: null }
}

export function parseWhen(text: string, today: string): WhenHint {
  const { time, part } = parseTime(text)
  return { day: parseDay(text, today), time, part }
}

/** Minutes range of a day part (studio-local wall clock). */
export function partRange(part: DayPart): [number, number] {
  return part === 'morning' ? [0, 12 * 60] : part === 'day' ? [12 * 60, 17 * 60] : [17 * 60, 24 * 60]
}
