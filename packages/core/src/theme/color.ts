/** Minimal color math: hex parsing, WCAG contrast, HSL, mixing. No dependencies. */

export interface Rgb {
  r: number
  g: number
  b: number
}

const HEX = /^#([0-9a-f]{6})$/i

export function isHex(value: string): boolean {
  return HEX.test(value)
}

export function parseHex(hex: string): Rgb {
  const m = HEX.exec(hex)
  if (!m) throw new Error(`invalid color ${hex}`)
  const n = parseInt(m[1]!, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a)
  const y = parseHex(b)
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t })
}

export function toHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = parseHex(hex)
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0)
  else if (max === gg) h = (bb - rr) / d + 2
  else h = (rr - gg) / d + 4
  return { h: h * 60, s, l }
}

/** rgba() string for translucent tints of a hex color. */
export function alpha(hex: string, a: number): string {
  const { r, g, b } = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/**
 * "Acid" colors make the interface look cheap and hurt readability: fully saturated
 * mid-lightness hues (#FF0000, #00FF00, #0000FF...). Brand accents must be deep or muted.
 */
export function isHarsh(hex: string): boolean {
  const { s, l } = toHsl(hex)
  return s > 0.85 && l > 0.38 && l < 0.62
}

/** Moves `fg` toward `toward` until it reaches `ratio` against `bg` (or gives up). */
export function ensureContrast(fg: string, bg: string, ratio: number, toward: string): string {
  let out = fg
  for (let i = 1; i <= 20 && contrast(out, bg) < ratio; i++) out = mix(fg, toward, i / 20)
  return out
}
