import type { BodyType } from '../tenant/constants.ts'
import { normalizeText, parseWhen, word, type DayPart } from './dates.ts'

/**
 * Deterministic JSON-intent router. It answers when no LLM is configured, when the studio's
 * daily AI budget is spent, or when the LLM call fails — the assistant never just stops.
 * Output is plain data; the server turns it into tool calls with the same executors (and
 * the same scope rules) the LLM path uses.
 */
export interface ServiceRef {
  id: string
  name: string
  category?: string
  summary?: string
}

export type ClientIntent =
  | { type: 'book'; serviceId: string | null; day: string | null; time: string | null; part: DayPart | null; bodyType: BodyType | null }
  | { type: 'prices'; serviceId: string | null; bodyType: BodyType | null }
  | { type: 'services' }
  | { type: 'hours'; day: string | null }
  | { type: 'address' }
  | { type: 'contacts' }
  | { type: 'my_bookings' }
  | { type: 'cancel' }
  | { type: 'reschedule' }
  | { type: 'greeting' }
  | { type: 'unknown' }

export type OwnerIntent =
  | { type: 'day_schedule'; day: string }
  | { type: 'stats'; days: number }
  | { type: 'find_customer'; query: string }
  | { type: 'free_slots'; serviceId: string | null; day: string }
  | { type: 'pending' }
  | { type: 'unknown' }

const BODY_WORDS: [RegExp, BodyType][] = [
  [word('больш\\p{L}* внедорожник\\p{L}*|полноразмерн\\p{L}*'), 'large_suv'],
  [word('внедорожник\\p{L}*|джип\\p{L}*|suv'), 'suv'],
  [word('кроссовер\\p{L}*|паркетник\\p{L}*'), 'crossover'],
  [word('хэтчбек\\p{L}*|хетчбек\\p{L}*|хэтч|хетч'), 'hatchback'],
  [word('седан\\p{L}*|универсал\\p{L}*|лифтбек\\p{L}*'), 'sedan'],
  [word('купе|кабриолет\\p{L}*|родстер\\p{L}*'), 'coupe'],
  [word('минивэн\\p{L}*|минивен\\p{L}*|фургон\\p{L}*|микроавтобус\\p{L}*'), 'minivan'],
  [word('пикап\\p{L}*'), 'pickup'],
]

export function detectBodyType(text: string): BodyType | null {
  const t = normalizeText(text)
  return BODY_WORDS.find(([re]) => re.test(t))?.[1] ?? null
}

const STOP = new Set(['для', 'или', 'под', 'над', 'при', 'без', 'про', 'все', 'вся', 'это', 'как', 'что', 'мне', 'нам', 'вас', 'ваш', 'хочу', 'можно', 'нужно', 'надо', 'запись', 'записать', 'записаться', 'услуга', 'услуги'])

/** Crude Russian stem: enough to match "мойку"/"мойка", "керамику"/"керамика", "химчистку"/"химчистка". */
export function stem(w: string): string {
  return w.length <= 4 ? w : w.slice(0, Math.max(4, Math.min(6, w.length - 2)))
}

function stems(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(/[^\p{L}\d]+/u)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map(stem),
  )
}

/** Best matching service by shared word stems of its own name (tenant data, not code). */
export function matchService(text: string, services: ServiceRef[]): string | null {
  const words = stems(text)
  let best: { id: string; score: number } | null = null
  for (const s of services) {
    const name = stems(s.name)
    let score = 0
    for (const w of name) if (words.has(w)) score += 3
    for (const w of stems(`${s.category ?? ''} ${s.summary ?? ''}`)) if (words.has(w)) score += 1
    if (score > 0 && (!best || score > best.score)) best = { id: s.id, score }
  }
  return best?.id ?? null
}

const has = (t: string, src: string) => word(src).test(t)

export function routeClientIntent(text: string, ctx: { today: string; services: ServiceRef[] }): ClientIntent {
  const t = normalizeText(text)
  const when = parseWhen(t, ctx.today)
  const serviceId = matchService(t, ctx.services)
  const bodyType = detectBodyType(t)

  if (has(t, 'отмен\\p{L}*|не смогу|не приеду|не получится приехать')) return { type: 'cancel' }
  if (has(t, 'перенес\\p{L}*|перенос\\p{L}*|сдвин\\p{L}*|другое время|поменять время')) return { type: 'reschedule' }
  if (has(t, 'мо[яи] запис\\p{L}*|когда я записан\\p{L}*|на когда я|я записан\\p{L}*')) return { type: 'my_bookings' }
  const asksPrice = has(t, 'сколько стоит|сколько будет стоить|цен\\p{L}*|стоимост\\p{L}*|прайс\\p{L}*|почем|по чем')
  const wantsBooking = has(t, 'запис\\p{L}*|свободн\\p{L}*|окошк\\p{L}*|окн[оа]|забронир\\p{L}*|приехать|подъехать|есть время|когда можно')
  if (asksPrice && !wantsBooking && !when.day && !when.time) return { type: 'prices', serviceId, bodyType }
  if (wantsBooking || ((when.day || when.time || when.part) && serviceId)) {
    return { type: 'book', serviceId, day: when.day, time: when.time, part: when.part, bodyType }
  }
  if (asksPrice) return { type: 'prices', serviceId, bodyType }
  if (has(t, 'часы работы|график|режим работы|во сколько (?:вы )?(?:открыва\\p{L}*|закрыва\\p{L}*|работа\\p{L}*)|до скольки|работаете')) return { type: 'hours', day: when.day }
  if (has(t, 'адрес|где вы|где находит\\p{L}*|как (?:до вас )?(?:добраться|доехать|проехать)|карт[аеу]')) return { type: 'address' }
  if (has(t, 'телефон\\p{L}*|позвонить|связаться|номер')) return { type: 'contacts' }
  if (has(t, 'услуг\\p{L}*|что вы делаете|чем занимаетесь|какие работы')) return { type: 'services' }
  if (serviceId) return { type: 'prices', serviceId, bodyType }
  if (has(t, 'привет|здравствуй\\p{L}*|добрый (?:день|вечер)|доброе утро|хай')) return { type: 'greeting' }
  return { type: 'unknown' }
}

export function routeOwnerIntent(text: string, ctx: { today: string; services: ServiceRef[] }): OwnerIntent {
  const t = normalizeText(text)
  const when = parseWhen(t, ctx.today)
  if (has(t, 'неподтвержд\\p{L}*|жд\\p{L}* подтвержд\\p{L}*|подтвердить')) return { type: 'pending' }
  const customer = /(?:^|\s)(?:(?:найди|найти|покажи)(?:\s+клиент\p{L}*)?|клиент\p{L}*)\s+(.+)$/u.exec(t)
  if (customer && !has(t, 'сколько клиентов')) return { type: 'find_customer', query: customer[1]!.trim().slice(0, 60) }
  if (has(t, 'выручк\\p{L}*|статистик\\p{L}*|заработ\\p{L}*|оплат\\p{L}*|средний чек|загрузк\\p{L}*')) {
    const days = has(t, 'недел\\p{L}*') ? 7 : has(t, 'сегодня') ? 1 : 30
    return { type: 'stats', days }
  }
  if (has(t, 'свободн\\p{L}*|окн[оа]|окошк\\p{L}*')) return { type: 'free_slots', serviceId: matchService(t, ctx.services), day: when.day ?? ctx.today }
  if (when.day || has(t, 'расписани\\p{L}*|записи|кто записан|план')) return { type: 'day_schedule', day: when.day ?? ctx.today }
  return { type: 'unknown' }
}
