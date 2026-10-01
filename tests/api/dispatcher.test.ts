import { randomUUID, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookingBody, call, createTenant, env, localIso, randomIp, signInOwner, type ApiTenant } from './helpers.ts'

const subtle = webcrypto.subtle as unknown as SubtleCrypto
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url')
const bs = (b: Uint8Array) => b as BufferSource

interface Received {
  path: string
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

/** A local HTTPS "push service": records requests; paths containing /gone/ answer 410. */
let server: Server
let port = 0
const received: Received[] = []

beforeAll(async () => {
  server = createServer({ key: readFileSync(env.tlsKey), cert: readFileSync(env.tlsCert) }, (req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) })
      res.statusCode = (req.url ?? '').includes('/gone/') ? 410 : 201
      res.end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})

afterAll(() => {
  server.close()
})

async function subscriber(path: string) {
  const ua = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const pub = new Uint8Array(await subtle.exportKey('raw', ua.publicKey))
  const auth = webcrypto.getRandomValues(new Uint8Array(16))
  return {
    ua,
    pub,
    auth,
    subscription: { endpoint: `https://127.0.0.1:${port}${path}`, keys: { p256dh: b64u(pub), auth: b64u(auth) } },
  }
}

async function decrypt(body: Buffer, ua: CryptoKeyPair, uaPublic: Uint8Array, auth: Uint8Array): Promise<Record<string, string>> {
  const salt = body.subarray(0, 16)
  const idlen = body[20]!
  const asPublic = body.subarray(21, 21 + idlen)
  const asKey = await subtle.importKey('raw', bs(asPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256))
  const h = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) => {
    const k = await subtle.importKey('raw', bs(ikm), 'HKDF', false, ['deriveBits'])
    return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: bs(s), info: bs(info) }, k, n * 8))
  }
  const te = new TextEncoder()
  const ikm = await h(auth, ecdh, Buffer.concat([te.encode('WebPush: info\0'), uaPublic, asPublic]), 32)
  const cek = await h(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await h(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12)
  const key = await subtle.importKey('raw', bs(cek), 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: bs(nonce) }, key, bs(body.subarray(21 + idlen))))
  return JSON.parse(new TextDecoder().decode(plain.subarray(0, -1))) as Record<string, string>
}

const dispatch = (secret = env.dispatcherSecret) =>
  call<Record<string, number>>('/notify-dispatcher', { method: 'POST', headers: { 'x-dispatcher-secret': secret } })

async function ownerSubscribe(t: ApiTenant, subscription: unknown) {
  const jwt = await signInOwner(t.owner.email, t.owner.password)
  const res = await fetch(`${env.gateway}/rest/v1/rpc/owner_push_subscribe`, {
    method: 'POST',
    headers: { apikey: env.anonKey, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_tenant: t.id, p_subscription: subscription, p_user_agent: 'test' }),
  })
  expect(res.status).toBe(200)
}

describe('notification dispatcher (real Web Push over HTTPS)', () => {
  it('refuses calls without the shared secret', async () => {
    expect((await dispatch('wrong')).status).toBe(401)
  })

  it('delivers encrypted messages to the client and owner, disables gone endpoints, never re-sends', async () => {
    const t = await createTenant({ status: 'live' })
    const ip = randomIp()
    const created = await call<{ booking: { id: string }; client_key: string }>(`/public-api/t/${t.slug}/bookings`, {
      method: 'POST', json: bookingBody(t, localIso(t.timezone, 3, '11:00')), client: { ip }, headers: { 'idempotency-key': randomUUID() },
    })
    expect(created.status).toBe(201)
    const client = await subscriber(`/ok/${randomUUID()}`)
    const sub = await call(`/public-api/t/${t.slug}/push/subscribe`, {
      method: 'POST', json: { subscription: client.subscription }, client: { ip, clientKey: created.body.client_key },
    })
    expect(sub.status).toBe(201)
    const owner = await subscriber(`/gone/${randomUUID()}`)
    await ownerSubscribe(t, owner.subscription)

    const before = received.length
    const run = await dispatch()
    expect(run.status, JSON.stringify(run.body)).toBe(200)
    const mine = received.slice(before).filter((r) => r.path === new URL(client.subscription.endpoint).pathname)
    expect(mine).toHaveLength(1)
    expect(mine[0]!.headers['content-encoding']).toBe('aes128gcm')
    expect(String(mine[0]!.headers.authorization)).toMatch(/^vapid t=.+, k=/)
    const msg = await decrypt(mine[0]!.body, client.ua, client.pub, client.auth)
    expect(msg.title).toBe('Вы записаны')
    expect(msg.url).toBe(`/s/${t.slug}/history/${created.body.booking.id}`)

    const ownerHits = received.slice(before).filter((r) => r.path === new URL(owner.subscription.endpoint).pathname)
    expect(ownerHits).toHaveLength(1)
    const ownerMsg = await decrypt(ownerHits[0]!.body, owner.ua, owner.pub, owner.auth)
    expect(ownerMsg.title).toBe('Новая запись')
    expect(ownerMsg.body).toContain('Тест Клиент')

    // The 410 disabled the owner's subscription.
    const subs = await fetch(`${env.gateway}/rest/v1/push_subscriptions?select=endpoint,disabled_at&tenant_id=eq.${t.id}`, {
      headers: { apikey: env.serviceKey, authorization: `Bearer ${env.serviceKey}` },
    }).then((r) => r.json() as Promise<{ endpoint: string; disabled_at: string | null }[]>)
    expect(subs.find((s) => s.endpoint === owner.subscription.endpoint)!.disabled_at).not.toBeNull()
    expect(subs.find((s) => s.endpoint === client.subscription.endpoint)!.disabled_at).toBeNull()

    // A second run delivers nothing new for this booking.
    const count = received.length
    await dispatch()
    expect(received.slice(count).filter((r) => r.path === new URL(client.subscription.endpoint).pathname)).toHaveLength(0)
  })

  it('a demo studio never delivers anything', async () => {
    const t = await createTenant({ status: 'demo' })
    const ip = randomIp()
    const created = await call<{ client_key: string }>(`/public-api/t/${t.slug}/bookings`, {
      method: 'POST', json: bookingBody(t, localIso(t.timezone, 3, '12:00')), client: { ip }, headers: { 'idempotency-key': randomUUID() },
    })
    const client = await subscriber(`/demo/${randomUUID()}`)
    await call(`/public-api/t/${t.slug}/push/subscribe`, { method: 'POST', json: { subscription: client.subscription }, client: { ip, clientKey: created.body.client_key } })
    const before = received.length
    await dispatch()
    expect(received.slice(before).filter((r) => r.path.startsWith('/demo/'))).toHaveLength(0)
  })
})
