/** WebCrypto helpers that run unchanged in Deno, Node >= 20 and browsers. */

const subtle = () => globalThis.crypto.subtle

export function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const utf8 = (s: string) => new TextEncoder().encode(s)

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const input = typeof data === 'string' ? utf8(data) : data
  return new Uint8Array(await subtle().digest('SHA-256', input as BufferSource))
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return toHex(await sha256(data))
}

/** PostgREST encodes bytea parameters as "\x<hex>". */
export async function sha256Bytea(data: string): Promise<string> {
  return `\\x${await sha256Hex(data)}`
}

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await subtle().sign('HMAC', key, utf8(message)))
}

export function randomToken(bytes = 32): string {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)))
}

/** Constant-time string comparison (for shared secrets). */
export function safeEqual(a: string, b: string): boolean {
  const x = utf8(a)
  const y = utf8(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/**
 * Capability tokens are derived, not stored: HMAC(server secret, purpose + scope). The same
 * idempotency key always yields the same token, so a retried "create booking" request can
 * hand back the same access link while the database only ever sees SHA-256(token).
 */
export async function deriveToken(secret: string, purpose: 'booking' | 'profile', scope: string): Promise<string> {
  return toBase64Url(await hmacSha256(secret, `${purpose}:v1:${scope}`))
}

/** Plausible capability token (43-char base64url of 32 bytes). */
export function looksLikeToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}
