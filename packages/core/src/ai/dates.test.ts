import { describe, expect, it } from 'vitest'
import { parseDay, parseTime, parseWhen } from './dates.ts'

// 2026-10-02 is a Friday.
const today = '2026-10-02'

describe('parseDay', () => {
  it('relative words', () => {
    expect(parseDay('Можно сегодня?', today)).toBe('2026-10-02')
    expect(parseDay('запишите на завтра', today)).toBe('2026-10-03')
    expect(parseDay('Послезавтра утром', today)).toBe('2026-10-04')
    expect(parseDay('через 3 дня', today)).toBe('2026-10-05')
    expect(parseDay('через два дня', today)).toBe('2026-10-04')
    expect(parseDay('через неделю', today)).toBe('2026-10-09')
  })
  it('weekdays, the coming one; "следующий" skips this week', () => {
    expect(parseDay('в субботу', today)).toBe('2026-10-03')
    expect(parseDay('в понедельник', today)).toBe('2026-10-05')
    expect(parseDay('в пятницу', today)).toBe('2026-10-02')
    expect(parseDay('в следующую субботу', today)).toBe('2026-10-10')
    expect(parseDay('на выходных', today)).toBe('2026-10-03')
  })
  it('calendar dates roll to the next year when already past', () => {
    expect(parseDay('15 октября', today)).toBe('2026-10-15')
    expect(parseDay('1 сентября', today)).toBe('2027-09-01')
    expect(parseDay('на 20.10', today)).toBe('2026-10-20')
    expect(parseDay('31.02', today)).toBeNull()
    expect(parseDay('12.03.2027', today)).toBe('2027-03-12')
  })
  it('does not take times or unrelated words for dates', () => {
    expect(parseDay('в 10.30', today)).toBeNull()
    expect(parseDay('сколько стоит мойка', today)).toBeNull()
    expect(parseDay('завтрак не нужен', today)).toBeNull()
  })
})

describe('parseTime', () => {
  it('explicit times', () => {
    expect(parseTime('в 10:30').time).toBe('10:30')
    expect(parseTime('к 9').time).toBe('09:00')
    expect(parseTime('около 18 часов').time).toBe('18:00')
    expect(parseTime('в 3').time).toBe('15:00')
    expect(parseTime('в 7 вечера').time).toBe('19:00')
    expect(parseTime('в 10 утра').time).toBe('10:00')
    expect(parseTime('в 10.30').time).toBe('10:30')
  })
  it('parts of the day', () => {
    expect(parseTime('утром').part).toBe('morning')
    expect(parseTime('после обеда').part).toBe('day')
    expect(parseTime('вечером').part).toBe('evening')
    expect(parseTime('мойка').part).toBeNull()
  })
  it('a date is not a time', () => {
    expect(parseWhen('на 15.10', today)).toEqual({ day: '2026-10-15', time: null, part: null })
  })
})
