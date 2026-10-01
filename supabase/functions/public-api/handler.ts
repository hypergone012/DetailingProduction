/**
 * public-api — the only door for anonymous clients. No registration: a client is identified
 * by a device key (`x-client-key`) and/or a per-booking capability token (`x-booking-token`).
 * Only SHA-256 of either ever reaches the database. Tenant, price, duration, buffers,
 * resource and status are decided by SQL; this layer validates input, normalizes phones,
 * rate-limits, derives tokens and shapes responses.
 */
import {
  availabilityQuerySchema,
  cancelSchema,
  contactUpdateSchema,
  createBookingSchema,
  pushSubscriptionSchema,
  rescheduleSchema,
  vehicleSaveSchema,
  type Bootstrap,
  type BookingResponse,
  type BookingView,
  type MediaView,
  type ProfileView,
} from '../_vendor/core/api/contracts.ts'
import { bookingToIcs } from '../_vendor/core/booking/ics.ts'
import { canonicalJson } from '../_vendor/core/tenant/normalize.ts'
import { buildManifest } from '../_vendor/core/tenant/manifest.ts'
import { deriveToken, looksLikeToken, sha256Bytea, sha256Hex } from '../_vendor/core/crypto.ts'
import { config } from '../_shared/env.ts'
import { corsHeaders, HttpError, idempotencyKey, json, parse, readBytes, readJson, router, type RouteContext } from '../_shared/http.ts'
import { clientIp, limit } from '../_shared/limits.ts'
import { normalizePhone } from '../_shared/phone.ts'
import { rpc } from '../_shared/postgrest.ts'
import { decorateMedia, publicUrl, removeObjects, uploadObject } from '../_shared/storage.ts'

interface TenantRef {
  id: string
  slug: string
  name: string
  status: string
  timezone: string
  locale: string
  currency: string
}

const slugOf = (ctx: RouteContext) => {
  const s = ctx.params.slug ?? ''
  if (!/^[a-z0-9-]{1,40}$/.test(s)) throw new HttpError('TENANT_NOT_FOUND', 'Студия не найдена')
  return s
}

/** Generous read limit per IP and studio; stricter limits on writes below. */
async function readLimit(ctx: RouteContext, slug: string) {
  await limit('read', `${slug}:${clientIp(ctx.req)}`, 600, 60)
}

async function clientKeyHash(req: Request): Promise<string | null> {
  const key = req.headers.get('x-client-key')
  return looksLikeToken(key) ? await sha256Bytea(key) : null
}

async function bookingTokenHash(req: Request): Promise<string | null> {
  const token = req.headers.get('x-booking-token')
  return looksLikeToken(token) ? await sha256Bytea(token) : null
}

async function requireClientKey(req: Request): Promise<string> {
  const h = await clientKeyHash(req)
  if (!h) throw new HttpError('PROFILE_NOT_FOUND', 'Профиль не найден на этом устройстве')
  return h
}

const tenantRef = (slug: string) => rpc<TenantRef>('api_public_tenant_ref', { p_slug: slug })

async function bootstrap(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await readLimit(ctx, slug)
  const data = await rpc<Bootstrap>('api_public_bootstrap', { p_slug: slug })
  await decorateMedia(data.media)
  const c = config()
  data.capabilities = { ai: Boolean(c.llm) && data.features.ai !== false, push: Boolean(c.vapid) && data.features.push !== false }
  return json(ctx.req, data, 200, { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' })
}

async function manifest(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await readLimit(ctx, slug)
  const data = await rpc<Bootstrap>('api_public_bootstrap', { p_slug: slug })
  const icon = data.media.find((m) => m.kind === 'icon')
  const app = ctx.url.searchParams.get('app') === 'owner' ? 'owner' : 'client'
  const body = buildManifest(
    {
      slug,
      name: data.tenant.name,
      tagline: data.profile.tagline,
      locale: data.tenant.locale,
      themePreset: data.branding.themePreset,
      accent: data.branding.accent,
      icons: (icon?.variants ?? []).map((v) => ({ w: v.w, url: publicUrl(v.path), purpose: v.purpose })),
    },
    config().appUrl,
    app,
  )
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  })
}

async function availability(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await readLimit(ctx, slug)
  const q = parse(availabilityQuerySchema, Object.fromEntries(ctx.url.searchParams))
  const data = await rpc('api_public_availability', {
    p_slug: slug,
    p_service_id: q.service_id,
    p_body_type: q.body_type ?? null,
    p_addon_ids: q.addon_ids,
    p_from_day: q.from,
    p_days: q.days,
    p_ignore_booking: q.ignore_booking ?? null,
  })
  return json(ctx.req, data)
}

async function createBooking(ctx: RouteContext) {
  const slug = slugOf(ctx)
  const ip = clientIp(ctx.req)
  await limit('book', `${slug}:${ip}`, 12, 3600)
  const key = idempotencyKey(ctx.req)
  const body = parse(createBookingSchema, await readJson(ctx.req))
  const tenant = await tenantRef(slug)
  const phone = normalizePhone(body.contact.phone, tenant.locale)
  await limit('book-phone', `${slug}:${phone}`, 6, 3600)
  const vehicle = 'id' in body.vehicle ? { id: body.vehicle.id } : body.vehicle
  const payload = {
    service_id: body.service_id,
    addon_ids: body.addon_ids,
    starts_at: new Date(body.starts_at).toISOString(),
    vehicle,
    contact: { name: body.contact.name, phone, email: body.contact.email || null },
    note: body.note,
  }
  const requestHash = await sha256Hex(canonicalJson(payload))
  const secret = config().accessTokenSecret
  const accessToken = await deriveToken(secret, 'booking', `${tenant.id}:${key}`)
  const derivedKey = await deriveToken(secret, 'profile', `${tenant.id}:${key}`)
  const tokenHash = await sha256Bytea(accessToken)

  const call = (profileKeyHash: string, create: boolean) =>
    rpc<{ booking: BookingView; profile_id: string; replayed: boolean }>('api_public_create_booking', {
      p_slug: slug,
      p_idempotency_key: key,
      p_request_hash: requestHash,
      p_payload: payload,
      p_profile_key_hash: profileKeyHash,
      p_create_profile: create,
      p_token_hash: tokenHash,
    })

  const existing = await clientKeyHash(ctx.req)
  let result: { booking: BookingView; profile_id: string; replayed: boolean }
  let clientKey: string | null = null
  try {
    if (existing) {
      result = await call(existing, false)
    } else {
      result = await call(await sha256Bytea(derivedKey), true)
      clientKey = derivedKey
    }
  } catch (e) {
    // A forgotten/revoked device key must not block a booking: start a fresh profile.
    if (!(e instanceof HttpError && e.code === 'PROFILE_NOT_FOUND' && existing)) throw e
    result = await call(await sha256Bytea(derivedKey), true)
    clientKey = derivedKey
  }
  return json(
    ctx.req,
    { booking: result.booking, access_token: accessToken, client_key: clientKey, replayed: result.replayed },
    result.replayed ? 200 : 201,
  )
}

interface ClientAuth {
  p_token_hash: string | null
  p_profile_key_hash: string | null
  p_booking_id: string | null
}

async function clientAuth(ctx: RouteContext): Promise<ClientAuth> {
  const id = ctx.params.id
  if (id && !/^[0-9a-f-]{36}$/.test(id)) throw new HttpError('BOOKING_NOT_FOUND', 'Запись не найдена')
  const token = await bookingTokenHash(ctx.req)
  const profile = token ? null : await clientKeyHash(ctx.req)
  if (!token && !profile) throw new HttpError('BOOKING_NOT_FOUND', 'Запись не найдена или ссылка недействительна')
  return { p_token_hash: token, p_profile_key_hash: profile, p_booking_id: id ?? null }
}

async function manageLimit(ctx: RouteContext, slug: string) {
  await limit('manage', `${slug}:${clientIp(ctx.req)}`, 120, 60)
}

async function getBooking(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await manageLimit(ctx, slug)
  const data = await rpc<BookingResponse>('api_public_booking', { p_slug: slug, ...(await clientAuth(ctx)) })
  await decorateMedia(data.media)
  return json(ctx.req, data)
}

async function reschedule(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await manageLimit(ctx, slug)
  const key = idempotencyKey(ctx.req)
  const body = parse(rescheduleSchema, await readJson(ctx.req))
  const startsAt = new Date(body.starts_at).toISOString()
  const data = await rpc<{ booking: BookingView; replayed: boolean }>('api_public_reschedule', {
    p_slug: slug,
    p_idempotency_key: key,
    p_request_hash: await sha256Hex(`${ctx.params.id}:${startsAt}`),
    ...(await clientAuth(ctx)),
    p_starts_at: startsAt,
  })
  return json(ctx.req, data)
}

async function cancel(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await manageLimit(ctx, slug)
  const body = parse(cancelSchema, await readJson(ctx.req))
  const data = await rpc<{ booking: BookingView }>('api_public_cancel', {
    p_slug: slug,
    ...(await clientAuth(ctx)),
    p_reason: body.reason ?? null,
  })
  return json(ctx.req, data)
}

async function rescheduleOptions(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await manageLimit(ctx, slug)
  const from = ctx.url.searchParams.get('from') ?? ''
  const days = Number(ctx.url.searchParams.get('days') ?? '7')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !Number.isInteger(days) || days < 1 || days > 14) throw new HttpError('VALIDATION')
  const data = await rpc('api_public_reschedule_availability', { p_slug: slug, ...(await clientAuth(ctx)), p_from_day: from, p_days: days })
  return json(ctx.req, data)
}

async function calendar(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await manageLimit(ctx, slug)
  const data = await rpc<BookingResponse>('api_public_booking', { p_slug: slug, ...(await clientAuth(ctx)) })
  const app = config().appUrl
  const ics = bookingToIcs(data.booking, data.studio, {
    host: new URL(app).host,
    manageUrl: `${app}/s/${slug}/history/${data.booking.id}`,
  })
  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="booking-${data.booking.code}.ics"`,
      'cache-control': 'no-store',
      ...corsHeaders(ctx.req),
    },
  })
}

async function profile(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await manageLimit(ctx, slug)
  const data = await rpc<ProfileView>('api_public_profile', { p_slug: slug, p_profile_key_hash: await requireClientKey(ctx.req) })
  const media: MediaView[] = [
    ...data.vehicles.flatMap((v) => (v.photo ? [v.photo] : [])),
    ...data.bookings.flatMap((b) => b.media),
  ]
  await decorateMedia(media)
  return json(ctx.req, data)
}

async function ensureProfile(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await limit('profile', `${slug}:${clientIp(ctx.req)}`, 10, 3600)
  const existing = await clientKeyHash(ctx.req)
  if (existing) {
    try {
      const r = await rpc<{ profile_id: string }>('api_public_profile_ensure', { p_slug: slug, p_profile_key_hash: existing })
      return json(ctx.req, { profile_id: r.profile_id, client_key: null })
    } catch (e) {
      if (!(e instanceof HttpError && e.code === 'PROFILE_NOT_FOUND')) throw e
    }
  }
  const key = idempotencyKey(ctx.req)
  const tenant = await tenantRef(slug)
  const clientKey = await deriveToken(config().accessTokenSecret, 'profile', `${tenant.id}:me:${key}`)
  const r = await rpc<{ profile_id: string }>('api_public_profile_ensure', { p_slug: slug, p_profile_key_hash: await sha256Bytea(clientKey) })
  return json(ctx.req, { profile_id: r.profile_id, client_key: clientKey }, 201)
}

async function updateProfile(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await manageLimit(ctx, slug)
  const body = parse(contactUpdateSchema, await readJson(ctx.req))
  const tenant = await tenantRef(slug)
  const contact: Record<string, unknown> = {}
  if (body.name !== undefined) contact.name = body.name
  if (body.phone !== undefined) contact.phone = normalizePhone(body.phone, tenant.locale)
  if (body.email !== undefined) contact.email = body.email || null
  await rpc('api_public_profile_update', { p_slug: slug, p_profile_key_hash: await requireClientKey(ctx.req), p_contact: contact })
  return json(ctx.req, { ok: true })
}

async function revokeProfile(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await manageLimit(ctx, slug)
  await rpc('api_public_profile_revoke', { p_slug: slug, p_profile_key_hash: await requireClientKey(ctx.req) })
  return json(ctx.req, { ok: true })
}

async function saveVehicle(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await limit('vehicle', `${slug}:${clientIp(ctx.req)}`, 60, 3600)
  const body = parse(vehicleSaveSchema, await readJson(ctx.req))
  const data = await rpc<{ vehicle_id: string }>('api_public_vehicle_save', {
    p_slug: slug,
    p_profile_key_hash: await requireClientKey(ctx.req),
    p_vehicle: body,
  })
  return json(ctx.req, data, body.id ? 200 : 201)
}

async function archiveVehicle(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await manageLimit(ctx, slug)
  await rpc('api_public_vehicle_archive', { p_slug: slug, p_profile_key_hash: await requireClientKey(ctx.req), p_vehicle_id: ctx.params.id })
  return json(ctx.req, { ok: true })
}

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/webp': { ext: 'webp', magic: (b) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' },
}

async function vehiclePhoto(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await limit('photo', `${slug}:${clientIp(ctx.req)}`, 20, 3600)
  const keyHash = await requireClientKey(ctx.req)
  const type = (ctx.req.headers.get('content-type') ?? '').split(';')[0]!.trim()
  const kind = IMAGE_TYPES[type]
  if (!kind) throw new HttpError('UNSUPPORTED_MEDIA', 'Поддерживаются JPEG, PNG и WebP')
  const bytes = await readBytes(ctx.req, 3 * 1024 * 1024)
  if (!kind.magic(bytes)) throw new HttpError('UNSUPPORTED_MEDIA', 'Файл не похож на изображение')
  const tenant = await tenantRef(slug)
  const vehicleId = ctx.params.id!
  if (!/^[0-9a-f-]{36}$/.test(vehicleId)) throw new HttpError('VEHICLE_NOT_FOUND', 'Автомобиль не найден в гараже')
  const path = `${tenant.id}/vehicles/${vehicleId}/${crypto.randomUUID()}.${kind.ext}`
  await uploadObject('private-media', path, bytes, type)
  try {
    const r = await rpc<{ media_id: string }>('api_public_vehicle_photo', {
      p_slug: slug,
      p_profile_key_hash: keyHash,
      p_vehicle_id: vehicleId,
      p_path: path,
      p_width: null,
      p_height: null,
    })
    return json(ctx.req, r, 201)
  } catch (e) {
    await removeObjects('private-media', [path]) // not the caller's vehicle: drop the upload
    throw e
  }
}

async function pushConfig(ctx: RouteContext) {
  const v = config().vapid
  return json(ctx.req, { enabled: Boolean(v), vapid_public_key: v?.publicKey ?? null }, 200, { 'cache-control': 'public, max-age=300' })
}

async function pushSubscribe(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await limit('push', `${slug}:${clientIp(ctx.req)}`, 30, 3600)
  const body = (await readJson(ctx.req)) as { subscription?: unknown; booking_id?: string }
  const sub = parse(pushSubscriptionSchema, body.subscription)
  const token = await bookingTokenHash(ctx.req)
  const profileKey = token ? null : await clientKeyHash(ctx.req)
  if (!token && !profileKey) throw new HttpError('PROFILE_NOT_FOUND', 'Профиль не найден на этом устройстве')
  await rpc('api_public_push_subscribe', {
    p_slug: slug,
    p_profile_key_hash: profileKey,
    p_token_hash: token,
    p_booking_id: token ? (body.booking_id ?? null) : null,
    p_subscription: sub,
    p_user_agent: ctx.req.headers.get('user-agent')?.slice(0, 300) ?? null,
  })
  return json(ctx.req, { ok: true }, 201)
}

async function pushUnsubscribe(ctx: RouteContext) {
  const slug = slugOf(ctx)
  await limit('push', `${slug}:${clientIp(ctx.req)}`, 30, 3600)
  const body = (await readJson(ctx.req)) as { endpoint?: string }
  if (typeof body.endpoint !== 'string' || !body.endpoint.startsWith('https://')) throw new HttpError('VALIDATION')
  await rpc('api_public_push_unsubscribe', { p_slug: slug, p_endpoint: body.endpoint })
  return json(ctx.req, { ok: true })
}

export const handler = router('public-api', [
  { method: 'GET', path: '/push/config', handle: pushConfig },
  { method: 'GET', path: '/t/:slug', handle: bootstrap },
  { method: 'GET', path: '/t/:slug/manifest.webmanifest', handle: manifest },
  { method: 'GET', path: '/t/:slug/availability', handle: availability },
  { method: 'POST', path: '/t/:slug/bookings', handle: createBooking },
  { method: 'GET', path: '/t/:slug/bookings/:id', handle: getBooking },
  { method: 'POST', path: '/t/:slug/bookings/:id/reschedule', handle: reschedule },
  { method: 'POST', path: '/t/:slug/bookings/:id/cancel', handle: cancel },
  { method: 'GET', path: '/t/:slug/bookings/:id/calendar.ics', handle: calendar },
  { method: 'GET', path: '/t/:slug/bookings/:id/availability', handle: rescheduleOptions },
  { method: 'GET', path: '/t/:slug/me', handle: profile },
  { method: 'POST', path: '/t/:slug/me', handle: ensureProfile },
  { method: 'PATCH', path: '/t/:slug/me', handle: updateProfile },
  { method: 'DELETE', path: '/t/:slug/me', handle: revokeProfile },
  { method: 'POST', path: '/t/:slug/me/vehicles', handle: saveVehicle },
  { method: 'DELETE', path: '/t/:slug/me/vehicles/:id', handle: archiveVehicle },
  { method: 'POST', path: '/t/:slug/me/vehicles/:id/photo', handle: vehiclePhoto },
  { method: 'POST', path: '/t/:slug/push/subscribe', handle: pushSubscribe },
  { method: 'POST', path: '/t/:slug/push/unsubscribe', handle: pushUnsubscribe },
])
