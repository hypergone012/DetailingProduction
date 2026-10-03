import { describe, expect, it } from 'vitest'
import { iconPlacement, planAppIcon, type IconPixels } from './icon.ts'

type RGBA = [number, number, number, number]

/** A w×h picture painted pixel by pixel from its centre-relative coordinates (in units of the width). */
function picture(w: number, h: number, paint: (dx: number, dy: number, x: number, y: number) => RGBA): IconPixels {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set(paint((x + 0.5 - w / 2) / w, (y + 0.5 - h / 2) / w, x, y), (y * w + x) * 4)
  return { width: w, height: h, data }
}

const DARK: RGBA = [8, 8, 9, 255]
const GOLD: RGBA = [214, 168, 74, 255]
const CLEAR: RGBA = [0, 0, 0, 0]
const ring = (r: number) => (dx: number, dy: number) => (Math.abs(Math.hypot(dx, dy) - r) < 0.03 ? GOLD : DARK)

describe('planAppIcon', () => {
  it('keeps a designed icon edge to edge; the maskable one shows the whole picture in the safe zone', () => {
    const plan = planAppIcon(picture(128, 128, ring(0.33)), '#ffffff')
    expect(plan.mode).toBe('solid')
    expect(plan.background).toBe('#080809')
    expect(plan.crop).toEqual({ left: 0, top: 0, width: 1, height: 1 })
    expect(plan.scale).toEqual({ any: 1, maskable: 0.8, apple: 1, favicon: 1 })
  })

  it('shrinks the maskable icon further when the artwork reaches the edges', () => {
    const plan = planAppIcon(picture(128, 128, ring(0.46)), '#ffffff')
    expect(plan.scale.any).toBe(1)
    expect(plan.scale.maskable).toBeGreaterThan(0.7)
    expect(plan.scale.maskable).toBeLessThan(0.8)
  })

  it('ignores a soft glow in the background', () => {
    const glow = (dx: number, dy: number): RGBA => {
      const g = Math.max(0, 30 * (1 - Math.hypot(dx, dy) / 0.5))
      return Math.abs(Math.hypot(dx, dy) - 0.3) < 0.03 ? GOLD : [8 + g, 8 + g, 9 + g * 0.6, 255]
    }
    expect(planAppIcon(picture(128, 128, glow), '#ffffff').scale.maskable).toBe(0.8)
  })

  it('trims a transparent logo and centres it on the studio background', () => {
    const logo = picture(200, 100, (_dx, _dy, x, y) => (x >= 20 && x < 60 && y >= 30 && y < 70 ? GOLD : CLEAR))
    const plan = planAppIcon(logo, '#0e0f11')
    expect(plan.mode).toBe('transparent')
    expect(plan.background).toBe('#0e0f11')
    expect(plan.crop).toEqual({ left: 0.1, top: 0.3, width: 0.2, height: 0.4 })
    expect(plan.scale.any).toBe(0.78)
    // a square reaches its corners: half the diagonal of the crop
    expect(plan.scale.maskable).toBeCloseTo(0.38 / Math.SQRT1_2, 1)
  })

  it('lets a photo fill every icon', () => {
    const photo = picture(160, 120, (_dx, _dy, x, y) => [x, y * 2, 255 - x, 255])
    const plan = planAppIcon(photo, '#000000')
    expect(plan.mode).toBe('photo')
    expect(plan.scale.maskable).toBe(1)
    // centred square
    expect(plan.crop.left).toBeCloseTo(0.125)
    expect(plan.crop.width).toBeCloseTo(0.75)
  })
})

describe('iconPlacement', () => {
  it('centres the crop at its scale, inside the source', () => {
    const plan = planAppIcon(picture(128, 128, ring(0.3)), '#ffffff')
    const p = iconPlacement(plan, 1280, 1280, 'maskable', 512)
    expect(p.source).toEqual({ left: 0, top: 0, width: 1280, height: 1280 })
    expect(p.width).toBe(p.height)
    expect(p.left).toBe((512 - p.width) / 2)
    expect(iconPlacement(plan, 1280, 1280, 'any', 192)).toMatchObject({ left: 0, top: 0, width: 192, height: 192 })
  })
})
