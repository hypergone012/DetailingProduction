import { describe, expect, it } from 'vitest'
import { detectBodyType, matchService, routeClientIntent, routeOwnerIntent } from './intent.ts'

const services = [
  { id: 'wash', name: 'Детейлинг-мойка', category: 'wash' },
  { id: 'interior', name: 'Химчистка салона', category: 'interior' },
  { id: 'ceramic', name: 'Керамика в 3 слоя', category: 'protection' },
  { id: 'ppf', name: 'Полиуретановая плёнка на перед', category: 'protection' },
  { id: 'polish', name: 'Полировка кузова в 2 этапа', category: 'paint' },
]
const ctx = { today: '2026-10-02', services }

describe('matchService', () => {
  it('matches word forms of the studio’s own service names', () => {
    expect(matchService('хочу на мойку', services)).toBe('wash')
    expect(matchService('сколько стоит химчистка', services)).toBe('interior')
    expect(matchService('нужна керамика', services)).toBe('ceramic')
    expect(matchService('пленку на перед', services)).toBe('ppf')
    expect(matchService('полировку', services)).toBe('polish')
    expect(matchService('привет', services)).toBeNull()
  })
})

describe('detectBodyType', () => {
  it('maps everyday words to body types', () => {
    expect(detectBodyType('у меня внедорожник')).toBe('suv')
    expect(detectBodyType('большой внедорожник')).toBe('large_suv')
    expect(detectBodyType('кроссовер')).toBe('crossover')
    expect(detectBodyType('седан')).toBe('sedan')
    expect(detectBodyType('мойка')).toBeNull()
  })
})

describe('routeClientIntent', () => {
  it('booking requests with service, day, time and body type', () => {
    expect(routeClientIntent('Запишите на мойку завтра в 10, у меня кроссовер', ctx)).toEqual({
      type: 'book', serviceId: 'wash', day: '2026-10-03', time: '10:00', part: null, bodyType: 'crossover',
    })
    expect(routeClientIntent('есть свободное время в субботу утром?', ctx)).toMatchObject({ type: 'book', serviceId: null, day: '2026-10-03', part: 'morning' })
    expect(routeClientIntent('химчистка послезавтра', ctx)).toMatchObject({ type: 'book', serviceId: 'interior', day: '2026-10-04' })
  })
  it('prices, info and account intents', () => {
    expect(routeClientIntent('Сколько стоит керамика для внедорожника?', ctx)).toEqual({ type: 'prices', serviceId: 'ceramic', bodyType: 'suv' })
    expect(routeClientIntent('до скольки вы работаете', ctx)).toMatchObject({ type: 'hours' })
    expect(routeClientIntent('какой у вас адрес?', ctx)).toEqual({ type: 'address' })
    expect(routeClientIntent('дайте телефон', ctx)).toEqual({ type: 'contacts' })
    expect(routeClientIntent('какие услуги есть', ctx)).toEqual({ type: 'services' })
    expect(routeClientIntent('хочу отменить запись', ctx)).toEqual({ type: 'cancel' })
    expect(routeClientIntent('можно перенести на другое время?', ctx)).toEqual({ type: 'reschedule' })
    expect(routeClientIntent('когда я записан?', ctx)).toEqual({ type: 'my_bookings' })
    expect(routeClientIntent('Здравствуйте', ctx)).toEqual({ type: 'greeting' })
    expect(routeClientIntent('что такое жизнь', ctx)).toEqual({ type: 'unknown' })
  })
})

describe('routeOwnerIntent', () => {
  it('schedule, stats, customers, free slots and pending', () => {
    expect(routeOwnerIntent('кто записан завтра', ctx)).toEqual({ type: 'day_schedule', day: '2026-10-03' })
    expect(routeOwnerIntent('расписание', ctx)).toEqual({ type: 'day_schedule', day: '2026-10-02' })
    expect(routeOwnerIntent('выручка за неделю', ctx)).toEqual({ type: 'stats', days: 7 })
    expect(routeOwnerIntent('найди клиента Иванов', ctx)).toEqual({ type: 'find_customer', query: 'иванов' })
    expect(routeOwnerIntent('свободные окна на мойку в субботу', ctx)).toEqual({ type: 'free_slots', serviceId: 'wash', day: '2026-10-03' })
    expect(routeOwnerIntent('что ждёт подтверждения', ctx)).toEqual({ type: 'pending' })
  })
})
