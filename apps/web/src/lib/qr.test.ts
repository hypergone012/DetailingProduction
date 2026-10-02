import { describe, expect, it } from 'vitest'
import { qrPath, qrSvg } from './qr.ts'

describe('qr', () => {
  it('encodes a studio link with a quiet zone and the three finder patterns', () => {
    const { size, d } = qrPath('https://studio.example/s/demo-studio/')
    expect(size).toBeGreaterThanOrEqual(21 + 8)
    const dark = new Set(d.match(/M\d+ \d+/g))
    // Finder patterns: 7×7 rings starting right after the 4-module border.
    for (const [x, y] of [[4, 4], [size - 11, 4], [4, size - 11]] as const) {
      expect(dark.has(`M${x} ${y}`)).toBe(true)
      expect(dark.has(`M${x + 6} ${y + 6}`)).toBe(true)
      expect(dark.has(`M${x + 1} ${y + 1}`)).toBe(false)
    }
    expect(dark.has('M0 0')).toBe(false)
  })

  it('renders black on white regardless of the app theme', () => {
    const svg = qrSvg('https://x.dev/s/a/')
    expect(svg).toContain('fill="#fff"')
    expect(svg).toContain('fill="#000"')
  })
})
