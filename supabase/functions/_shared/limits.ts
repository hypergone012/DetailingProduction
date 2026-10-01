import { sha256Hex } from '../_vendor/core/crypto.ts'
import { config } from './env.ts'
import { HttpError } from './http.ts'
import { rpc } from './postgrest.ts'

/**
 * Client IP from X-Forwarded-For, counting `TRUSTED_PROXY_HOPS` proxies from the right.
 * Headers a client can forge (X-Real-IP, CF-Connecting-IP, the left part of XFF) are ignored.
 * The hop count must be verified on the hosted platform (see SETUP.md, production checklist).
 */
export function clientIp(req: Request): string {
  const xff = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const hops = Math.max(1, config().trustedProxyHops)
  return xff[xff.length - hops] ?? xff[0] ?? 'unknown'
}

/** Atomic DB-backed fixed-window limiter (shared by all function instances). Stores a hash, never the raw IP. */
export async function limit(bucket: string, key: string, max: number, windowSeconds: number): Promise<void> {
  const hashed = (await sha256Hex(key)).slice(0, 32)
  const r = await rpc<{ allowed: boolean; reset_at: string }>('api_rate_limit_hit', {
    p_bucket: bucket,
    p_key: hashed,
    p_limit: max,
    p_window_seconds: windowSeconds,
  })
  if (!r.allowed) {
    const retry = Math.max(1, Math.ceil((new Date(r.reset_at).getTime() - Date.now()) / 1000))
    throw new HttpError('RATE_LIMITED', undefined, { 'retry-after': String(retry) })
  }
}
