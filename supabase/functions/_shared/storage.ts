import type { MediaView } from '../_vendor/core/api/contracts.ts'
import { config } from './env.ts'
import { HttpError } from './http.ts'

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const c = config()
  return { apikey: c.serviceRoleKey, authorization: `Bearer ${c.serviceRoleKey}`, ...extra }
}

export function publicUrl(path: string): string {
  return `${config().publicStorageUrl}/storage/v1/object/public/public-media/${path}`
}

export async function uploadObject(bucket: string, path: string, data: Uint8Array, contentType: string): Promise<void> {
  const res = await fetch(`${config().supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: serviceHeaders({ 'content-type': contentType, 'cache-control': 'max-age=31536000', 'x-upsert': 'false' }),
    body: data as BodyInit,
  })
  await res.body?.cancel()
  if (!res.ok) {
    console.error(`[storage upload] status=${res.status}`)
    throw new HttpError('INTERNAL')
  }
}

export async function removeObjects(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const res = await fetch(`${config().supabaseUrl}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: serviceHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ prefixes: paths }),
  })
  await res.body?.cancel()
}

/** Short-lived signed URLs for private objects (customer vehicles, before/after photos). */
export async function signUrls(bucket: string, paths: string[], expiresIn = 3600): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(paths)]
  if (unique.length === 0) return out
  const c = config()
  const res = await fetch(`${c.supabaseUrl}/storage/v1/object/sign/${bucket}`, {
    method: 'POST',
    headers: serviceHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ expiresIn, paths: unique }),
  })
  if (!res.ok) {
    await res.body?.cancel()
    console.error(`[storage sign] status=${res.status}`)
    return out
  }
  const rows = (await res.json()) as { path: string; signedURL: string | null; error: string | null }[]
  for (const r of rows) if (r.signedURL) out.set(r.path, `${c.publicStorageUrl}/storage/v1${r.signedURL.startsWith('/') ? '' : '/'}${r.signedURL}`)
  return out
}

/** Adds `url` to media (public URLs, or signed URLs for private objects) in place. */
export async function decorateMedia(items: MediaView[]): Promise<void> {
  const privatePaths: string[] = []
  for (const m of items) {
    if (m.bucket === 'public-media') {
      m.url = publicUrl(m.path)
      for (const v of m.variants ?? []) v.url = publicUrl(v.path)
    } else {
      privatePaths.push(m.path, ...(m.variants ?? []).map((v) => v.path))
    }
  }
  if (privatePaths.length === 0) return
  const signed = await signUrls('private-media', privatePaths)
  for (const m of items) {
    if (m.bucket !== 'private-media') continue
    m.url = signed.get(m.path)
    for (const v of m.variants ?? []) v.url = signed.get(v.path)
  }
}
