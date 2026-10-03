import { ApiError } from '@/lib/api/http'
import { prepareAppIcons, type PreparedIcon } from '@/lib/icons'
import { prepareImageSet, type PreparedImage } from '@/lib/image'
import { rpc, supabase } from '../api/client'

export interface Uploaded {
  path: string
  width: number
  height: number
  /** Every stored width (the largest is `path`), for a responsive srcset. */
  variants: { w: number; path: string }[]
}

/** Longest sides per use: a cover spans a 2× desktop screen, the rest are cards and tiles. */
export const PHOTO_SIDES = {
  hero: [2560, 1920, 1280],
  gallery: [1920, 960],
  service: [1920, 960],
  logo: [512],
  booking: [1600],
} as const

async function put(bucket: string, path: string, image: Pick<PreparedImage, 'blob'>) {
  const { error } = await supabase().storage.from(bucket).upload(path, image.blob, { contentType: image.blob.type, cacheControl: '31536000', upsert: false })
  if (error) throw new ApiError('UPLOAD_FAILED', 'Не удалось загрузить фото. Проверьте соединение и попробуйте ещё раз', 500)
}

/**
 * Resizes on the device, then uploads every size to `<tenant>/<folder>/<uuid>[-<w>]` — Storage
 * RLS only accepts objects under the studio's own folder for its managers.
 */
export async function uploadImage(tenantId: string, bucket: 'public-media' | 'private-media', folder: string, file: File, sides: readonly number[]): Promise<Uploaded> {
  let images: PreparedImage[]
  try {
    images = await prepareImageSet(file, [...sides])
  } catch {
    throw new ApiError('UNSUPPORTED_MEDIA', 'Не удалось прочитать фото. Выберите JPEG, PNG или WebP', 415)
  }
  const id = crypto.randomUUID()
  const ext = images[0]!.blob.type === 'image/webp' ? 'webp' : 'jpg'
  const stored = images.map((image, i) => ({ image, path: `${tenantId}/${folder}/${id}${i === 0 ? '' : `-${image.width}`}.${ext}` }))
  for (const s of stored) await put(bucket, s.path, s.image)
  return {
    path: stored[0]!.path,
    width: images[0]!.width,
    height: images[0]!.height,
    variants: stored.length > 1 ? stored.map((s) => ({ w: s.image.width, path: s.path })) : [],
  }
}

/**
 * The studio's app icon (home screen, install dialog, browser tab) from a logo or a designed
 * icon: every size is made on the device, uploaded, and registered as one `icon` media whose
 * newest upload wins — the manifest and the page head pick it up at once.
 */
export async function uploadAppIcon(tenantId: string, file: Blob, themeBackground: string): Promise<void> {
  let icons: PreparedIcon[]
  try {
    icons = await prepareAppIcons(file, themeBackground)
  } catch {
    throw new ApiError('UNSUPPORTED_MEDIA', 'Не удалось прочитать картинку. Выберите JPEG, PNG или WebP', 415)
  }
  const id = crypto.randomUUID()
  const stored = icons.map((icon) => ({ icon, path: `${tenantId}/branding/${id}-${icon.name}.png` }))
  for (const s of stored) await put('public-media', s.path, s.icon)
  const main = stored.find((s) => s.icon.purpose === 'any' && s.icon.size === 512)!
  await rpc('owner_register_media', {
    p_tenant: tenantId,
    p_media: {
      kind: 'icon',
      bucket: 'public-media',
      path: main.path,
      variants: stored.map((s) => ({ w: s.icon.size, path: s.path, purpose: s.icon.purpose })),
      width: 512,
      height: 512,
      alt: 'Значок приложения',
      sort_order: -Math.floor(Date.now() / 1000),
    },
  })
}

/** Deletes the media row; removes the stored files (and its sizes) only when no other row still uses them. */
export async function deleteMedia(mediaId: string, variantPaths: string[] = []): Promise<void> {
  const r = await rpc<{ bucket: string; path: string; delete_object: boolean }>('owner_delete_media', { p_media: mediaId })
  if (r.delete_object) await supabase().storage.from(r.bucket).remove([...new Set([r.path, ...variantPaths])])
}
