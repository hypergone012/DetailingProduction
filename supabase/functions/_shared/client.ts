import { looksLikeToken, sha256Bytea } from '../_vendor/core/crypto.ts'
import { HttpError, type RouteContext } from './http.ts'

/** Studio slug from /t/:slug/...; anything else is "not found", never a lookup. */
export function slugOf(ctx: RouteContext): string {
  const s = ctx.params.slug ?? ''
  if (!/^[a-z0-9-]{1,40}$/.test(s)) throw new HttpError('TENANT_NOT_FOUND', 'Студия не найдена')
  return s
}

/** SHA-256 (bytea literal) of this device's client key, if the request carries one. */
export async function clientKeyHash(req: Request): Promise<string | null> {
  const key = req.headers.get('x-client-key')
  return looksLikeToken(key) ? await sha256Bytea(key) : null
}
