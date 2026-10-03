/**
 * App icon layout, computed from the source picture's pixels. Shared by the deploy pipeline
 * (sharp) and the owner cabinet (canvas), so both turn the same picture into the same icons.
 *
 * - A picture with its own solid background (a designed app icon, a logo on a dark square)
 *   keeps its composition edge to edge. On the maskable icon the whole picture sits inside the
 *   safe zone (the central 80% every launcher shows), so the home screen shows the picture as
 *   designed; it shrinks further only when the artwork would leave the safe circle.
 * - A photo (no uniform edge) fills every icon; launchers crop photos gracefully.
 * - A logo on transparency is trimmed to its artwork and centred on the studio background
 *   with breathing room.
 */

export type AppIconPurpose = 'any' | 'maskable' | 'apple' | 'favicon'

/** Every icon a studio ships: manifest (any, maskable), iOS home screen (apple), browser tab (favicon). */
export const APP_ICON_SIZES = [
  { name: 'icon-192', size: 192, purpose: 'any' },
  { name: 'icon-512', size: 512, purpose: 'any' },
  { name: 'maskable-512', size: 512, purpose: 'maskable' },
  { name: 'apple-180', size: 180, purpose: 'apple' },
  { name: 'favicon-48', size: 48, purpose: 'favicon' },
] as const satisfies readonly { name: string; size: number; purpose: AppIconPurpose }[]

/** RGBA pixels, row-major (a small preview of the source is enough). */
export interface IconPixels {
  width: number
  height: number
  data: ArrayLike<number>
}

export interface AppIconPlan {
  mode: 'solid' | 'photo' | 'transparent'
  /** Fill behind the artwork, `#rrggbb`. */
  background: string
  /** Part of the source to draw, as fractions of its width and height (always inside it). */
  crop: { left: number; top: number; width: number; height: number }
  /** Longest side of the drawn crop as a fraction of the icon side; the crop is centred. */
  scale: Record<AppIconPurpose, number>
}

/** Artwork must stay inside this radius on a maskable icon (the spec's 40%, minus a margin). */
const SAFE_RADIUS = 0.38
/** The safe zone's diameter: launchers show at least this central part of a maskable icon. */
const SAFE_ZONE = 0.8
/** A pixel is artwork when a channel differs from the background by more than this. */
const INK = 40
/** Border samples further than this from their mean make the edge non-uniform (a photo). */
const UNIFORM = 48

const hex = (rgb: number[]) => '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')

export function planAppIcon(px: IconPixels, fallbackBackground: string): AppIconPlan {
  const { width: w, height: h, data } = px
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!] as const
  }

  // The edge: 16 points per side along the whole border.
  const border: (readonly [number, number, number, number])[] = []
  for (let k = 0; k <= 15; k++) {
    const x = Math.round((k / 15) * (w - 1))
    const y = Math.round((k / 15) * (h - 1))
    border.push(at(x, 0), at(x, h - 1), at(0, y), at(w - 1, y))
  }
  const transparent = border.some((p) => p[3] < 200)
  const mean = [0, 1, 2].map((c) => border.reduce((s, p) => s + p[c]!, 0) / border.length)
  const uniform = border.every((p) => [0, 1, 2].every((c) => Math.abs(p[c]! - mean[c]!) <= UNIFORM))

  const full = { left: 0, top: 0, width: 1, height: 1 }
  const square = w === h ? full : w > h ? { left: (w - h) / 2 / w, top: 0, width: h / w, height: 1 } : { left: 0, top: (h - w) / 2 / h, width: 1, height: w / h }

  if (!transparent && !uniform) {
    return { mode: 'photo', background: hex(mean), crop: square, scale: { any: 1, maskable: 1, apple: 1, favicon: 1 } }
  }

  const ink = transparent
    ? (x: number, y: number) => at(x, y)[3] > 32
    : (x: number, y: number) => {
        const p = at(x, y)
        return Math.abs(p[0] - mean[0]!) > INK || Math.abs(p[1] - mean[1]!) > INK || Math.abs(p[2] - mean[2]!) > INK
      }

  // The crop, in preview pixels: the centred square for a solid picture, the artwork's box for a transparent logo.
  let box = { x0: square.left * w, y0: square.top * h, x1: (square.left + square.width) * w, y1: (square.top + square.height) * h }
  if (transparent) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (ink(x, y)) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    if (x1 >= 0) box = { x0, y0, x1: x1 + 1, y1: y1 + 1 }
  }
  const side = Math.max(box.x1 - box.x0, box.y1 - box.y0)
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2

  // How far the artwork reaches from the crop's centre, in units of the crop's longest side.
  let reach = 0
  for (let y = Math.floor(box.y0); y < Math.ceil(box.y1); y++)
    for (let x = Math.floor(box.x0); x < Math.ceil(box.x1); x++)
      if (ink(x, y)) reach = Math.max(reach, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / side)

  const crop = { left: box.x0 / w, top: box.y0 / h, width: (box.x1 - box.x0) / w, height: (box.y1 - box.y0) / h }
  // The maskable icon shows what `any` shows, within the safe zone.
  const maskable = (any: number) => (reach > 0 ? Math.min(any * SAFE_ZONE, SAFE_RADIUS / reach) : any * SAFE_ZONE)
  if (transparent) {
    return { mode: 'transparent', background: fallbackBackground, crop, scale: { any: 0.78, maskable: maskable(0.78), apple: 0.78, favicon: 0.92 } }
  }
  return { mode: 'solid', background: hex(mean), crop, scale: { any: 1, maskable: maskable(1), apple: 1, favicon: 1 } }
}

/** Where to draw the crop on a `size` icon: integer box, centred, aspect kept. */
export function iconPlacement(plan: AppIconPlan, sourceWidth: number, sourceHeight: number, purpose: AppIconPurpose, size: number) {
  const sw = plan.crop.width * sourceWidth
  const sh = plan.crop.height * sourceHeight
  const k = (plan.scale[purpose] * size) / Math.max(sw, sh)
  const width = Math.max(1, Math.round(sw * k))
  const height = Math.max(1, Math.round(sh * k))
  return {
    source: {
      left: Math.round(plan.crop.left * sourceWidth),
      top: Math.round(plan.crop.top * sourceHeight),
      width: Math.max(1, Math.min(Math.round(sw), sourceWidth - Math.round(plan.crop.left * sourceWidth))),
      height: Math.max(1, Math.min(Math.round(sh), sourceHeight - Math.round(plan.crop.top * sourceHeight))),
    },
    left: Math.round((size - width) / 2),
    top: Math.round((size - height) / 2),
    width,
    height,
  }
}
