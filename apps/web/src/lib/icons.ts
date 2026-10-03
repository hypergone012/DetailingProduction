import { APP_ICON_SIZES, iconPlacement, planAppIcon, type AppIconPurpose } from '@dp/core/tenant/icon'
import { canvas, resample } from './image'

/**
 * The studio's app icon set (home screen, install dialog, browser tab), made on the device from
 * a logo or a designed icon. Same layout as the deploy pipeline: see `planAppIcon`.
 */

export interface PreparedIcon {
  name: string
  size: number
  purpose: AppIconPurpose
  blob: Blob
}

const png = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png'))

export async function prepareAppIcons(file: Blob, themeBackground: string): Promise<PreparedIcon[]> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    // A phone photo is 4000 px wide; icons need 512 at most, so work from a 1024 px copy.
    const base = Math.max(bitmap.width, bitmap.height) > 1024 ? resample(bitmap, ...within(bitmap.width, bitmap.height, 1024)) : bitmap
    const preview = resample(base, ...within(base.width, base.height, 256))
    const pixels = preview.getContext('2d')!.getImageData(0, 0, preview.width, preview.height)
    const plan = planAppIcon(pixels, themeBackground)
    const out: PreparedIcon[] = []
    for (const { name, size, purpose } of APP_ICON_SIZES) {
      const at = iconPlacement(plan, base.width, base.height, purpose, size)
      // The crop as is, then a high-quality downscale to its place on the icon.
      const crop = canvas(at.source.width, at.source.height)
      crop.getContext('2d')!.drawImage(base, at.source.left, at.source.top, at.source.width, at.source.height, 0, 0, crop.width, crop.height)
      const art = resample(crop, at.width, at.height)
      const icon = canvas(size, size)
      const ctx = icon.getContext('2d')!
      ctx.fillStyle = plan.background
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(art, at.left, at.top)
      out.push({ name, size, purpose, blob: await png(icon) })
    }
    return out
  } finally {
    bitmap.close()
  }
}

function within(width: number, height: number, side: number): [number, number] {
  const k = Math.min(1, side / Math.max(width, height))
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))]
}
