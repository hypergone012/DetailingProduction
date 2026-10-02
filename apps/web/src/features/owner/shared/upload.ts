import { ApiError } from '@/lib/api/http'
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

async function put(bucket: string, path: string, image: PreparedImage) {
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

/** Deletes the media row; removes the stored files (and its sizes) only when no other row still uses them. */
export async function deleteMedia(mediaId: string, variantPaths: string[] = []): Promise<void> {
  const r = await rpc<{ bucket: string; path: string; delete_object: boolean }>('owner_delete_media', { p_media: mediaId })
  if (r.delete_object) await supabase().storage.from(r.bucket).remove([...new Set([r.path, ...variantPaths])])
}
