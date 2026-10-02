import { ApiError } from '@/lib/api/http'
import { prepareImage } from '@/lib/image'
import { rpc, supabase } from '../api/client'

export interface Uploaded {
  path: string
  width: number
  height: number
}

/**
 * Downscales on the device, then uploads to `<tenant>/<folder>/<uuid>` — Storage RLS only
 * accepts objects under the studio's own folder for its managers.
 */
export async function uploadImage(tenantId: string, bucket: 'public-media' | 'private-media', folder: string, file: File, maxSide = 1600): Promise<Uploaded> {
  let blob: Blob
  try {
    blob = await prepareImage(file, maxSide)
  } catch {
    throw new ApiError('UNSUPPORTED_MEDIA', 'Не удалось прочитать фото. Выберите JPEG, PNG или WebP', 415)
  }
  const bitmap = await createImageBitmap(blob)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  const path = `${tenantId}/${folder}/${crypto.randomUUID()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`
  const { error } = await supabase().storage.from(bucket).upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false })
  if (error) throw new ApiError('UPLOAD_FAILED', 'Не удалось загрузить фото. Проверьте соединение и попробуйте ещё раз', 500)
  return { path, ...size }
}

/** Deletes the media row; removes the stored object only when no other row still uses it. */
export async function deleteMedia(mediaId: string): Promise<void> {
  const r = await rpc<{ bucket: string; path: string; delete_object: boolean }>('owner_delete_media', { p_media: mediaId })
  if (r.delete_object) await supabase().storage.from(r.bucket).remove([r.path])
}
