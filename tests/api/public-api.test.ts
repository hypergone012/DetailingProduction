import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { bookingBody, call, createTenant, env, localIso, randomIp, signInOwner, type Client } from './helpers.ts'

interface Booking {
  id: string
  code: string
  status: string
  price_cents: number
  local_start: string
  version: number
  vehicle: { id: string; body_type: string }
}
interface Created {
  booking: Booking
  access_token: string
  client_key: string | null
  replayed: boolean
}

describe('public catalog', () => {
  it('serves public studio data with media URLs and nothing private', async () => {
    const t = await createTenant()
    const r = await call<Record<string, unknown> & { media: unknown[]; tenant: { slug: string }; capabilities: Record<string, boolean> }>(`/public-api/t/${t.slug}`, { client: { ip: randomIp() } })
    expect(r.status).toBe(200)
    expect(r.body.tenant.slug).toBe(t.slug)
    expect(r.body.capabilities).toEqual({ ai: false, push: true })
    const text = JSON.stringify(r.body)
    for (const secret of ['owner_notes', 'internal_note', 'key_hash', 'token_hash', t.owner.email]) expect(text).not.toContain(secret)
    expect(r.headers.get('cache-control')).toContain('public')
  })

  it('hides draft studios and unknown slugs behind the same 404', async () => {
    const draft = await createTenant({ status: 'draft' })
    for (const slug of [draft.slug, 'no-such-studio']) {
      const r = await call<{ error: { code: string } }>(`/public-api/t/${slug}`, { client: { ip: randomIp() } })
      expect(r.status).toBe(404)
      expect(r.body.error.code).toBe('TENANT_NOT_FOUND')
    }
  })

  it('returns server-priced availability', async () => {
    const t = await createTenant()
    const from = localIso(t.timezone, 3, '00:00').slice(0, 10)
    const r = await call<{ price_cents: number; work_minutes: number; slots: { local_time: string }[] }>(
      `/public-api/t/${t.slug}/availability?service_id=${t.services.wash}&body_type=suv&addon_ids=${t.addons.wheels}&from=${from}&days=1`,
      { client: { ip: randomIp() } },
    )
    expect(r.status).toBe(200)
    expect(r.body.price_cents).toBe(550000)
    expect(r.body.work_minutes).toBe(120)
    expect(r.body.slots[0]!.local_time).toBe('09:00')
  })
})

describe('booking lifecycle over HTTP', () => {
  it('create -> retry -> view -> reschedule -> calendar -> cancel', async () => {
    const t = await createTenant()
    const client: Client = { ip: randomIp() }
    const key = randomUUID()
    const body = bookingBody(t, localIso(t.timezone, 3, '10:00'))

    const first = await call<Created>(`/public-api/t/${t.slug}/bookings`, { method: 'POST', json: body, client, headers: { 'idempotency-key': key } })
    expect(first.status).toBe(201)
    expect(first.body.booking.status).toBe('confirmed')
    expect(first.body.booking.price_cents).toBe(400000) // suv variant, decided by the server
    expect(first.body.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.body.client_key).toMatch(/^[A-Za-z0-9_-]{43}$/)

    // Network retry of the same request: same booking, same access, nothing new.
    const retry = await call<Created>(`/public-api/t/${t.slug}/bookings`, { method: 'POST', json: body, client, headers: { 'idempotency-key': key } })
    expect(retry.status).toBe(200)
    expect(retry.body.replayed).toBe(true)
    expect(retry.body.booking.id).toBe(first.body.booking.id)
    expect(retry.body.access_token).toBe(first.body.access_token)
    expect(retry.body.client_key).toBe(first.body.client_key)

    const byToken = await call<{ booking: Booking; studio: { name: string } }>(`/public-api/t/${t.slug}/bookings/${first.body.booking.id}`, {
      client: { ip: client.ip, token: first.body.access_token },
    })
    expect(byToken.status).toBe(200)
    expect(byToken.body.studio.name).toContain('Test')
    const byProfile = await call<{ booking: Booking }>(`/public-api/t/${t.slug}/bookings/${first.body.booking.id}`, {
      client: { ip: client.ip, clientKey: first.body.client_key },
    })
    expect(byProfile.body.booking.id).toBe(first.body.booking.id)

    const moved = await call<{ booking: Booking }>(`/public-api/t/${t.slug}/bookings/${first.body.booking.id}/reschedule`, {
      method: 'POST',
      json: { starts_at: localIso(t.timezone, 4, '15:00') },
      client: { ip: client.ip, token: first.body.access_token },
      headers: { 'idempotency-key': randomUUID() },
    })
    expect(moved.status).toBe(200)
    expect(moved.body.booking.local_start.endsWith('T15:00')).toBe(true)
    expect(moved.body.booking.version).toBe(2)

    const ics = await call<string>(`/public-api/t/${t.slug}/bookings/${first.body.booking.id}/calendar.ics`, {
      client: { ip: client.ip, token: first.body.access_token },
    })
    expect(ics.status).toBe(200)
    expect(ics.headers.get('content-type')).toContain('text/calendar')
    expect(ics.body).toContain(`UID:booking-${first.body.booking.id}@`)
    expect(ics.body).toContain('SEQUENCE:2')

    const cancelled = await call<{ booking: Booking }>(`/public-api/t/${t.slug}/bookings/${first.body.booking.id}/cancel`, {
      method: 'POST',
      json: { reason: 'планы изменились' },
      client: { ip: client.ip, token: first.body.access_token },
    })
    expect(cancelled.body.booking.status).toBe('cancelled')
  })

  it('rejects bad input with precise codes', async () => {
    const t = await createTenant()
    const client: Client = { ip: randomIp() }
    const url = `/public-api/t/${t.slug}/bookings`
    const start = localIso(t.timezone, 3, '12:00')
    expect((await call(url, { method: 'POST', json: bookingBody(t, start), client })).status).toBe(400) // no Idempotency-Key
    const badPhone = await call<{ error: { code: string } }>(url, {
      method: 'POST', json: bookingBody(t, start, { contact: { name: 'X', phone: '12345' } }), client, headers: { 'idempotency-key': randomUUID() },
    })
    expect(badPhone.body.error.code).toBe('INVALID_PHONE')
    const injected = await call<{ error: { code: string } }>(url, {
      method: 'POST', json: { ...bookingBody(t, start), price_cents: 1 }, client, headers: { 'idempotency-key': randomUUID() },
    })
    expect(injected.status).toBe(400) // the client cannot send a price (strict schema)
    expect(injected.body.error.code).toBe('VALIDATION')
    const tenantInjection = await call<{ error: { code: string } }>(url, {
      method: 'POST', json: { ...bookingBody(t, start), tenant_id: randomUUID() }, client, headers: { 'idempotency-key': randomUUID() },
    })
    expect(tenantInjection.status).toBe(400)
    const ok = await call<Created>(url, { method: 'POST', json: bookingBody(t, start), client, headers: { 'idempotency-key': randomUUID() } })
    expect(ok.status).toBe(201)
    const taken = await call<{ error: { code: string; message: string } }>(url, {
      method: 'POST', json: bookingBody(t, start), client: { ip: randomIp() }, headers: { 'idempotency-key': randomUUID() },
    })
    expect(taken.status).toBe(409)
    expect(taken.body.error.code).toBe('SLOT_UNAVAILABLE')
    expect(taken.body.error.message).toMatch(/занято/)
  })

  it('a token never opens another booking or another studio', async () => {
    const a = await createTenant()
    const b = await createTenant()
    const client: Client = { ip: randomIp() }
    const ra = await call<Created>(`/public-api/t/${a.slug}/bookings`, { method: 'POST', json: bookingBody(a, localIso(a.timezone, 3, '10:00')), client, headers: { 'idempotency-key': randomUUID() } })
    const rb = await call<Created>(`/public-api/t/${b.slug}/bookings`, { method: 'POST', json: bookingBody(b, localIso(b.timezone, 3, '10:00')), client, headers: { 'idempotency-key': randomUUID() } })
    const tries = [
      call(`/public-api/t/${b.slug}/bookings/${ra.body.booking.id}`, { client: { ip: client.ip, token: ra.body.access_token } }),
      call(`/public-api/t/${a.slug}/bookings/${rb.body.booking.id}`, { client: { ip: client.ip, token: ra.body.access_token } }),
      call(`/public-api/t/${a.slug}/bookings/${rb.body.booking.id}`, { client: { ip: client.ip, clientKey: ra.body.client_key } }),
      call(`/public-api/t/${a.slug}/bookings/${ra.body.booking.id}`, { client: { ip: client.ip, token: 'x'.repeat(43) } }),
      call(`/public-api/t/${a.slug}/bookings/${ra.body.booking.id}`, { client: { ip: client.ip } }),
    ]
    for (const r of await Promise.all(tries)) expect(r.status).toBe(404)
  })
})

describe('garage', () => {
  it('device profile, vehicles, photo upload with signed URLs, isolation and revoke', async () => {
    const t = await createTenant()
    const ip = randomIp()
    const me = await call<{ client_key: string }>(`/public-api/t/${t.slug}/me`, { method: 'POST', client: { ip }, headers: { 'idempotency-key': randomUUID() } })
    expect(me.status).toBe(201)
    const client: Client = { ip, clientKey: me.body.client_key }
    const saved = await call<{ vehicle_id: string }>(`/public-api/t/${t.slug}/me/vehicles`, {
      method: 'POST', client, json: { make: 'Porsche', model: 'Taycan', body_type: 'sedan', nickname: 'Электро', plate: 'а777аа77' },
    })
    expect(saved.status).toBe(201)
    // 1x1 JPEG
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')
    const photo = await call(`/public-api/t/${t.slug}/me/vehicles/${saved.body.vehicle_id}/photo`, {
      method: 'POST', client, body: jpeg, headers: { 'content-type': 'image/jpeg' },
    })
    expect(photo.status).toBe(201)
    const notImage = await call<{ error: { code: string } }>(`/public-api/t/${t.slug}/me/vehicles/${saved.body.vehicle_id}/photo`, {
      method: 'POST', client, body: Buffer.from('<svg/>'), headers: { 'content-type': 'image/png' },
    })
    expect(notImage.status).toBe(415)
    const profile = await call<{ vehicles: { id: string; plate: string; photo: { url: string } }[] }>(`/public-api/t/${t.slug}/me`, { client })
    expect(profile.body.vehicles).toHaveLength(1)
    expect(profile.body.vehicles[0]!.plate).toBe('А777АА77')
    const signed = profile.body.vehicles[0]!.photo.url
    expect(signed).toContain('/storage/v1/object/sign/private-media/')
    const img = await fetch(signed)
    expect(img.status).toBe(200)
    // private objects are not public
    const publicTry = await fetch(signed.replace('/object/sign/', '/object/public/').replace(/\?.*$/, ''))
    expect(publicTry.status).not.toBe(200)

    // another device cannot touch this vehicle
    const other = await call<{ client_key: string }>(`/public-api/t/${t.slug}/me`, { method: 'POST', client: { ip }, headers: { 'idempotency-key': randomUUID() } })
    const steal = await call(`/public-api/t/${t.slug}/me/vehicles/${saved.body.vehicle_id}`, { method: 'DELETE', client: { ip, clientKey: other.body.client_key } })
    expect(steal.status).toBe(404)

    // a booking with the saved vehicle prices by its body type
    const booking = await call<Created>(`/public-api/t/${t.slug}/bookings`, {
      method: 'POST', client, headers: { 'idempotency-key': randomUUID() },
      json: bookingBody(t, localIso(t.timezone, 3, '11:00'), { vehicle: { id: saved.body.vehicle_id } }),
    })
    expect(booking.status).toBe(201)
    expect(booking.body.client_key).toBeNull() // existing profile reused
    expect(booking.body.booking.price_cents).toBe(300000)

    expect((await call(`/public-api/t/${t.slug}/me`, { method: 'DELETE', client })).status).toBe(200)
    expect((await call(`/public-api/t/${t.slug}/me`, { client })).status).toBe(404)
  })

  it('a forgotten device key does not block booking: a fresh profile is issued', async () => {
    const t = await createTenant()
    const r = await call<Created>(`/public-api/t/${t.slug}/bookings`, {
      method: 'POST', json: bookingBody(t, localIso(t.timezone, 3, '13:00')),
      client: { ip: randomIp(), clientKey: 'z'.repeat(43) }, headers: { 'idempotency-key': randomUUID() },
    })
    expect(r.status).toBe(201)
    expect(r.body.client_key).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe('edge protections', () => {
  it('rate-limits booking creation per IP with Retry-After', async () => {
    const t = await createTenant({ policy: { max_active_bookings_per_phone: 50 } })
    const client: Client = { ip: randomIp() }
    const statuses: number[] = []
    for (let i = 0; i < 13; i++) {
      const r = await call(`/public-api/t/${t.slug}/bookings`, {
        method: 'POST', json: bookingBody(t, localIso(t.timezone, 5 + Math.floor(i / 8), `${String(9 + (i % 8)).padStart(2, '0')}:00`)),
        client, headers: { 'idempotency-key': randomUUID() },
      })
      statuses.push(r.status)
      if (r.status === 429) expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0)
    }
    expect(statuses.slice(0, 12).every((s) => s === 201 || s === 409)).toBe(true)
    expect(statuses[12]).toBe(429)
  })

  it('CORS allows only configured origins', async () => {
    const t = await createTenant()
    const ok = await call(`/public-api/t/${t.slug}`, { client: { ip: randomIp(), origin: 'http://127.0.0.1:5173' } })
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173')
    const evil = await call(`/public-api/t/${t.slug}`, { client: { ip: randomIp(), origin: 'https://evil.example' } })
    expect(evil.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('caps request bodies', async () => {
    const t = await createTenant()
    const r = await call(`/public-api/t/${t.slug}/bookings`, {
      method: 'POST', body: JSON.stringify({ note: 'x'.repeat(100_000) }), headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      client: { ip: randomIp() },
    })
    expect(r.status).toBe(413)
  })
})

describe('owner share link', () => {
  it('an owner gets a client link; it opens only that booking; a stranger is refused', async () => {
    const t = await createTenant()
    const created = await call<Created>(`/public-api/t/${t.slug}/bookings`, {
      method: 'POST', json: bookingBody(t, localIso(t.timezone, 3, '16:00')), client: { ip: randomIp() }, headers: { 'idempotency-key': randomUUID() },
    })
    const jwt = await signInOwner(t.owner.email, t.owner.password)
    const link = await call<{ url: string }>(`/owner-api/bookings/${created.body.booking.id}/share-link`, {
      method: 'POST', headers: { authorization: `Bearer ${jwt}` },
    })
    expect(link.status).toBe(201)
    const token = new URL(link.body.url).hash.replace('#t=', '')
    expect(link.body.url).toContain(`/s/${t.slug}/b/${created.body.booking.id}#t=`)
    const view = await call<{ booking: { id: string } }>(`/public-api/t/${t.slug}/bookings/${created.body.booking.id}`, { client: { ip: randomIp(), token } })
    expect(view.body.booking.id).toBe(created.body.booking.id)
    // anon key instead of a user JWT
    const anon = await call(`/owner-api/bookings/${created.body.booking.id}/share-link`, { method: 'POST', headers: { authorization: `Bearer ${env.anonKey}` } })
    expect(anon.status).toBe(401)
    // owner of another studio
    const other = await createTenant()
    const otherJwt = await signInOwner(other.owner.email, other.owner.password)
    const foreign = await call(`/owner-api/bookings/${created.body.booking.id}/share-link`, { method: 'POST', headers: { authorization: `Bearer ${otherJwt}` } })
    expect(foreign.status).toBe(404)
  })
})
