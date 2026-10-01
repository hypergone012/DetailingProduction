/**
 * Web Push without third-party libraries, WebCrypto only (Deno, Node, browsers):
 *   - payload encryption: RFC 8291 + RFC 8188 (Content-Encoding: aes128gcm)
 *   - sender authentication: VAPID, RFC 8292 (ES256 JWT)
 */
import { fromBase64Url, toBase64Url } from '../crypto.ts'

const subtle = () => globalThis.crypto.subtle
const enc = new TextEncoder()

export interface PushSubscriptionKeys {
  endpoint: string
  p256dh: string
  auth: string
}

export interface VapidKeys {
  publicKey: string // base64url, 65-byte uncompressed P-256 point
  privateKey: string // base64url, 32-byte scalar
  subject: string // mailto: or https: contact
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, length * 8))
}

/** Encrypts one payload for one subscription. Returns the HTTP body (header + ciphertext). */
export async function encryptPayload(
  payload: Uint8Array,
  uaPublicB64: string,
  authSecretB64: string,
  opts: { salt?: Uint8Array; serverKeys?: CryptoKeyPair; recordSize?: number } = {},
): Promise<Uint8Array> {
  const uaPublic = fromBase64Url(uaPublicB64)
  const authSecret = fromBase64Url(authSecretB64)
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('invalid subscription keys')
  const server = opts.serverKeys ?? ((await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic = new Uint8Array(await subtle().exportKey('raw', server.publicKey))
  const uaKey = await subtle().importKey('raw', uaPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, server.privateKey, 256))
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)
  const salt = opts.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const rs = opts.recordSize ?? 4096
  if (payload.length + 17 > rs) throw new Error('payload too large for one record')
  const plaintext = concat(payload, new Uint8Array([2])) // 0x02: last record delimiter
  const aesKey = await subtle().importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, plaintext as BufferSource))
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, rs)
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, ciphertext)
}

async function vapidSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = fromBase64Url(keys.publicKey)
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key must be an uncompressed P-256 point')
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: keys.privateKey,
    x: toBase64Url(pub.slice(1, 33)),
    y: toBase64Url(pub.slice(33, 65)),
    ext: false,
  }
  return subtle().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

/** `Authorization` header value for a push endpoint (RFC 8292). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, ttlSeconds = 12 * 3600, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin
  const header = toBase64Url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = toBase64Url(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + ttlSeconds, sub: keys.subject })))
  const signingInput = `${header}.${claims}`
  const key = await vapidSigningKey(keys)
  const sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)))
  return `vapid t=${signingInput}.${toBase64Url(sig)}, k=${keys.publicKey}`
}

export interface PushResult {
  status: 'sent' | 'gone' | 'failed'
  http_status: number | null
  error?: string
}

/** Sends one encrypted message. 404/410 mean the subscription is gone for good. */
export async function sendPush(
  sub: PushSubscriptionKeys,
  message: unknown,
  keys: VapidKeys,
  opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string; fetchImpl?: typeof fetch } = {},
): Promise<PushResult> {
  try {
    const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth)
    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'content-encoding': 'aes128gcm',
      ttl: String(opts.ttl ?? 86400),
      urgency: opts.urgency ?? 'normal',
      authorization: await vapidAuthorization(sub.endpoint, keys),
    }
    if (opts.topic) headers.topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
    const res = await (opts.fetchImpl ?? fetch)(sub.endpoint, { method: 'POST', headers, body: body as BodyInit })
    await res.body?.cancel()
    if (res.status === 404 || res.status === 410) return { status: 'gone', http_status: res.status }
    if (res.ok) return { status: 'sent', http_status: res.status }
    return { status: 'failed', http_status: res.status, error: `push service responded ${res.status}` }
  } catch (e) {
    // Keep the reason, never the endpoint URL (it identifies the device).
    const reason = e instanceof Error ? `${e.name}: ${e.message}${e.cause instanceof Error ? ` (${e.cause.message})` : ''}` : 'error'
    return { status: 'failed', http_status: null, error: reason.replace(/https?:\/\/\S+/g, '<endpoint>').slice(0, 200) }
  }
}

/** New VAPID key pair (for `pnpm push:vapid`). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = await subtle().exportKey('jwk', pair.privateKey)
  const pub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey))
  return { publicKey: toBase64Url(pub), privateKey: jwk.d! }
}
