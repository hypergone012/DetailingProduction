/**
 * The server's own secrets (/etc/dp/dp.env), generated once on the server by server/secrets.ts
 * and never shown anywhere. Pure WebCrypto: runs in Deno (installer) and Node (tests).
 *
 * A value that exists is never replaced: booking links are derived from ACCESS_TOKEN_SECRET,
 * push subscriptions are bound to the VAPID key, sessions and API keys to the JWT secret, and
 * the database roles to their passwords. Only missing values are generated; the anon and
 * service keys are re-signed only when the JWT secret itself is new.
 */

export const SECRET_KEYS = [
  'DP_JWT_SECRET',
  'DP_ANON_KEY',
  'DP_SERVICE_ROLE_KEY',
  'DP_PG_PASSWORD',
  'DP_AUTHENTICATOR_PASSWORD',
  'DP_AUTH_ADMIN_PASSWORD',
  'DP_STORAGE_ADMIN_PASSWORD',
  'ACCESS_TOKEN_SECRET',
  'DISPATCHER_SECRET',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
] as const

export type SecretKey = (typeof SECRET_KEYS)[number]

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const utf8 = (s: string) => new TextEncoder().encode(s)

export function randomSecret(bytes: number): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** An HS256 API key for a database role, like the keys a Supabase project issues. */
export async function signRoleKey(role: 'anon' | 'service_role', jwtSecret: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64url(utf8(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = b64url(utf8(JSON.stringify({ role, iss: 'dp-server', iat: now, exp: now + 20 * 365 * 86400 })))
  const key = await crypto.subtle.importKey('raw', utf8(jwtSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(`${header}.${payload}`)))
  return `${header}.${payload}.${b64url(sig)}`
}

/** Web Push (VAPID) pair in the format @dp/core expects: raw public point, private scalar `d`. */
export async function vapidPair(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { publicKey: b64url(pub), privateKey: jwk.d! }
}

/** Every secret: the existing ones unchanged, the missing ones generated. */
export async function planServerSecrets(existing: Partial<Record<string, string>>): Promise<{ values: Record<SecretKey, string>; created: SecretKey[] }> {
  const values: Partial<Record<SecretKey, string>> = {}
  const created: SecretKey[] = []
  const keep = (k: SecretKey) => {
    const v = existing[k]?.trim()
    if (v) values[k] = v
    return Boolean(v)
  }
  for (const k of SECRET_KEYS) keep(k)
  const gen = (k: SecretKey, v: string) => {
    values[k] = v
    created.push(k)
  }
  const newJwt = !values.DP_JWT_SECRET
  if (newJwt) gen('DP_JWT_SECRET', randomSecret(48))
  if (newJwt || !values.DP_ANON_KEY) gen('DP_ANON_KEY', await signRoleKey('anon', values.DP_JWT_SECRET!))
  if (newJwt || !values.DP_SERVICE_ROLE_KEY) gen('DP_SERVICE_ROLE_KEY', await signRoleKey('service_role', values.DP_JWT_SECRET!))
  for (const k of ['DP_PG_PASSWORD', 'DP_AUTHENTICATOR_PASSWORD', 'DP_AUTH_ADMIN_PASSWORD', 'DP_STORAGE_ADMIN_PASSWORD'] as const) if (!values[k]) gen(k, randomSecret(24))
  if (!values.ACCESS_TOKEN_SECRET) gen('ACCESS_TOKEN_SECRET', randomSecret(48))
  if (!values.DISPATCHER_SECRET) gen('DISPATCHER_SECRET', randomSecret(32))
  if (!values.VAPID_PUBLIC_KEY || !values.VAPID_PRIVATE_KEY) {
    const pair = await vapidPair()
    gen('VAPID_PUBLIC_KEY', pair.publicKey)
    gen('VAPID_PRIVATE_KEY', pair.privateKey)
  }
  return { values: values as Record<SecretKey, string>, created }
}

/** KEY=value lines (no quoting: every value here is base64url or a JWT). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}
