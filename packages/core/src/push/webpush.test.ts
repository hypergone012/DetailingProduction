import { importJWK, jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'
import { deriveToken, fromBase64Url, looksLikeToken, safeEqual, toBase64Url } from '../crypto.ts'
import { bookingToIcs } from '../booking/ics.ts'
import { renderMessage } from './messages.ts'
import { encryptPayload, generateVapidKeys, sendPush, vapidAuthorization } from './webpush.ts'

const subtle = globalThis.crypto.subtle

/** What a browser does on receipt (RFC 8291 decryption), written independently of the sender. */
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, uaPublic: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16)
  const idlen = body[20]!
  const asPublic = body.slice(21, 21 + idlen)
  const ciphertext = body.slice(21 + idlen)
  expect(rs).toBe(4096)
  const asKey = await subtle.importKey('raw', asPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256))
  const h = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) => {
    const k = await subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
    return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s as BufferSource, info: info as BufferSource }, k, n * 8))
  }
  const te = new TextEncoder()
  const keyInfo = new Uint8Array([...te.encode('WebPush: info\0'), ...uaPublic, ...asPublic])
  const ikm = await h(auth, ecdh, keyInfo, 32)
  const cek = await h(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await h(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12)
  const aes = await subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aes, ciphertext as BufferSource))
  expect(plain.at(-1)).toBe(2)
  return new TextDecoder().decode(plain.slice(0, -1))
}

async function subscriber() {
  const ua = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const uaPublic = new Uint8Array(await subtle.exportKey('raw', ua.publicKey))
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return { ua, uaPublic, auth, p256dh: toBase64Url(uaPublic), authB64: toBase64Url(auth) }
}

describe('web push', () => {
  it('encrypts a payload the subscriber can decrypt (RFC 8291 aes128gcm)', async () => {
    const s = await subscriber()
    const message = JSON.stringify({ title: 'Вы записаны', body: 'Керамика, завтра в 10:00' })
    const body = await encryptPayload(new TextEncoder().encode(message), s.p256dh, s.authB64)
    expect(await decrypt(body, s.ua, s.uaPublic, s.auth)).toBe(message)
  })

  it('signs a VAPID JWT bound to the push service origin', async () => {
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:ops@example.test' }
    const header = await vapidAuthorization('https://push.example.test/send/abc', keys, 3600, Date.now())
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header)!
    expect(m[2]).toBe(keys.publicKey)
    const pub = fromBase64Url(keys.publicKey)
    const jwk = { kty: 'EC', crv: 'P-256', x: toBase64Url(pub.slice(1, 33)), y: toBase64Url(pub.slice(33)) }
    const { payload } = await jwtVerify(m[1]!, await importJWK(jwk, 'ES256'))
    expect(payload.aud).toBe('https://push.example.test')
    expect(payload.sub).toBe('mailto:ops@example.test')
    expect(payload.exp! - Date.now() / 1000).toBeLessThanOrEqual(3600)
  })

  it('maps push service responses to delivery outcomes', async () => {
    const s = await subscriber()
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:ops@example.test' }
    const sub = { endpoint: 'https://push.example.test/x', p256dh: s.p256dh, auth: s.authB64 }
    let seen: { headers: Headers; body: Uint8Array } | null = null
    const respond = (status: number): typeof fetch => async (_url, init) => {
      seen = { headers: new Headers(init!.headers), body: init!.body as Uint8Array }
      return new Response(null, { status })
    }
    expect((await sendPush(sub, { a: 1 }, keys, { fetchImpl: respond(201), topic: 'booking-1' })).status).toBe('sent')
    expect(seen!.headers.get('content-encoding')).toBe('aes128gcm')
    expect(seen!.headers.get('topic')).toBe('booking-1')
    expect(await decrypt(seen!.body, s.ua, s.uaPublic, s.auth)).toBe('{"a":1}')
    expect((await sendPush(sub, {}, keys, { fetchImpl: respond(410) })).status).toBe('gone')
    expect((await sendPush(sub, {}, keys, { fetchImpl: respond(404) })).status).toBe('gone')
    expect((await sendPush(sub, {}, keys, { fetchImpl: respond(503) }))).toMatchObject({ status: 'failed', http_status: 503 })
  })
})

describe('capability tokens', () => {
  it('are deterministic per scope and unguessable across scopes', async () => {
    const a = await deriveToken('s'.repeat(40), 'booking', 'tenant:key-1')
    expect(await deriveToken('s'.repeat(40), 'booking', 'tenant:key-1')).toBe(a)
    expect(await deriveToken('s'.repeat(40), 'booking', 'tenant:key-2')).not.toBe(a)
    expect(await deriveToken('s'.repeat(40), 'profile', 'tenant:key-1')).not.toBe(a)
    expect(await deriveToken('t'.repeat(40), 'booking', 'tenant:key-1')).not.toBe(a)
    expect(looksLikeToken(a)).toBe(true)
    expect(safeEqual(a, a)).toBe(true)
    expect(safeEqual(a, a.slice(0, -1) + 'x')).toBe(false)
  })
})

describe('ics', () => {
  it('exports a UTC event with a stable UID and the booking version as SEQUENCE', () => {
    const ics = bookingToIcs(
      {
        id: 'b1',
        code: 'K7Q2MX',
        status: 'confirmed',
        starts_at: '2026-10-05T07:00:00+00:00',
        ends_at: '2026-10-07T09:00:00+00:00',
        version: 3,
        service: { name: 'Керамика 9H, 3 слоя' },
        vehicle: { make: 'BMW', model: 'M5', plate: 'А001АА77' },
      },
      { name: 'GRAPHITE Detailing', address: 'Москва, Электрозаводская ул., 27с8', phone: '+74951234567' },
      { host: 'app.example', manageUrl: 'https://app.example/s/graphite/history/b1', now: new Date('2026-10-01T00:00:00Z') },
    )
    expect(ics).toContain('UID:booking-b1@app.example')
    expect(ics).toContain('DTSTART:20261005T070000Z')
    expect(ics).toContain('DTEND:20261007T090000Z')
    expect(ics).toContain('SEQUENCE:3')
    expect(ics).toContain('STATUS:CONFIRMED')
    expect(ics).toContain('SUMMARY:Керамика 9H\\, 3 слоя — GRAPHITE Detailing')
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true)
    expect(ics.endsWith('\r\n')).toBe(true)
  })

  it('marks cancelled bookings', () => {
    const ics = bookingToIcs(
      { id: 'b2', code: 'X', status: 'cancelled', starts_at: '2026-10-05T07:00:00Z', ends_at: '2026-10-05T08:00:00Z', version: 2, service: { name: 'Мойка' } },
      { name: 'S', address: '', phone: null },
      { host: 'h', manageUrl: 'https://h/x' },
    )
    expect(ics).toContain('STATUS:CANCELLED')
    expect(ics).toContain('METHOD:CANCEL')
    expect(ics).not.toContain('VALARM')
  })
})

describe('notification texts', () => {
  const base = {
    tenant: { name: 'VERDE Car Care', slug: 'verde', timezone: 'Asia/Yekaterinburg' },
    booking: { id: 'b1', code: 'ABC234', status: 'confirmed', starts_at: '2026-10-02T05:00:00Z', service: { name: 'Эко-мойка' }, vehicle: { make: 'Kia', model: 'Rio' }, customer: { name: 'Анна' } },
    now: new Date('2026-10-01T12:00:00Z'),
  }
  it('uses the tenant timezone and relative days', () => {
    const m = renderMessage({ ...base, event: 'booking.reminder', audience: 'client' })
    // 05:00Z is 10:00 in Yekaterinburg (UTC+5), and that is "tomorrow" there
    expect(m.body).toContain('завтра в 10:00')
    expect(m.url).toBe('/s/verde/history/b1')
  })
  it('gives owners the customer and links to the cabinet', () => {
    const m = renderMessage({ ...base, event: 'booking.created', audience: 'owner' })
    expect(m.title).toBe('Новая запись')
    expect(m.body).toContain('Анна')
    expect(m.url).toBe('/s/verde/owner/bookings/b1')
  })
  it('never shows owner-only data to clients', () => {
    const m = renderMessage({ ...base, event: 'booking.created', audience: 'client' })
    expect(m.body).not.toContain('Анна')
  })
})
