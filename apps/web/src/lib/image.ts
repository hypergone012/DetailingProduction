/**
 * Photos are resized on the device before upload (faster on mobile networks, EXIF stripped).
 *
 * Quality matters: a single large canvas downscale aliases and smears fine detail (the
 * browser's default smoothing is the cheap one), so the photo is halved step by step with
 * high-quality smoothing and encoded at a high quality. Covers get several widths so a phone
 * loads a light file and a 2× desktop screen a sharp one.
 */

export interface PreparedImage {
  blob: Blob
  width: number
  height: number
}

export type Drawable = HTMLCanvasElement | ImageBitmap

export function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

function draw(target: HTMLCanvasElement, source: Drawable) {
  const ctx = target.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, target.width, target.height)
}

/** Halving steps, then the exact size: each step averages at most 2×2 pixels, as a good resampler would. */
export function resample(source: Drawable, width: number, height: number): HTMLCanvasElement {
  let current: Drawable = source
  while (current.width / 2 >= width && current.height / 2 >= height) {
    const half = canvas(Math.round(current.width / 2), Math.round(current.height / 2))
    draw(half, current)
    current = half
  }
  const out = canvas(width, height)
  draw(out, current)
  return out
}

async function encode(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  const toBlob = (type: string) => new Promise<Blob | null>((r) => c.toBlob(r, type, quality))
  const webp = await toBlob('image/webp')
  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await toBlob('image/jpeg')
  if (!jpeg) throw new Error('encode failed')
  return jpeg
}

/** Fits the longest side into `maxSide` without ever enlarging. */
export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * One photo at several longest sides, largest first. Sides larger than the photo collapse into
 * its own size (never upscaled), so the result may be shorter than `sides`.
 */
export async function prepareImageSet(file: Blob, sides: number[], quality = 0.88): Promise<PreparedImage[]> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const out: PreparedImage[] = []
    let source: Drawable = bitmap
    for (const side of [...sides].sort((a, b) => b - a)) {
      const size = fitSize(bitmap.width, bitmap.height, side)
      if (out.some((o) => o.width === size.width)) continue
      const c = resample(source, size.width, size.height)
      out.push({ blob: await encode(c, quality), ...size })
      source = c // the next, smaller size starts from this one
    }
    return out
  } finally {
    bitmap.close()
  }
}

export async function prepareImage(file: Blob, maxSide = 1600, quality = 0.88): Promise<Blob> {
  const [one] = await prepareImageSet(file, [maxSide], quality)
  return one!.blob
}
