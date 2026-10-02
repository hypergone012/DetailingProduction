import { describe, expect, it } from 'vitest'
import { fitSize } from './image'

describe('fitSize', () => {
  it('fits the longest side and keeps the aspect ratio', () => {
    expect(fitSize(4000, 2250, 2560)).toEqual({ width: 2560, height: 1440 })
    expect(fitSize(2250, 4000, 1920)).toEqual({ width: 1080, height: 1920 })
  })

  it('never enlarges a smaller photo', () => {
    expect(fitSize(1600, 900, 2560)).toEqual({ width: 1600, height: 900 })
  })
})
