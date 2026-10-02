import { describe, expect, it } from 'vitest'
import { nextActions } from './labels.ts'

describe('owner booking actions', () => {
  const now = Date.parse('2026-10-02T09:00:00Z')
  const inHours = (h: number) => new Date(now + h * 3600_000).toISOString()

  it('offers work statuses only from 12 h before the start, like private.transition_booking', () => {
    expect(nextActions('confirmed', inHours(48), now)).toEqual([])
    expect(nextActions('confirmed', inHours(12.5), now)).toEqual([])
    expect(nextActions('confirmed', inHours(11.5), now).map((a) => a.status)).toEqual(['in_progress', 'completed', 'no_show'])
    expect(nextActions('confirmed', inHours(-2), now).map((a) => a.status)).toEqual(['in_progress', 'completed', 'no_show'])
  })

  it('confirming a pending booking and finishing started work are always offered', () => {
    expect(nextActions('pending', inHours(48), now).map((a) => a.status)).toEqual(['confirmed'])
    expect(nextActions('in_progress', inHours(-1), now).map((a) => a.status)).toEqual(['completed'])
    expect(nextActions('cancelled', inHours(-1), now)).toEqual([])
  })
})
