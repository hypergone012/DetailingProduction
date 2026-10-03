import type { AvailabilityResponse, Bootstrap, BookingResponse, BookingView, CreateBookingRequest, CreateBookingResponse, ProfileView, VehicleInput } from '@dp/core/api/contracts'
import type { ChatResponse } from '@dp/core/ai/tools'
import { device } from '@/lib/device'
import { callFunction } from './http'

declare global {
  interface Window {
    /** The studio data request index.html starts before the app code loads. */
    __dpBoot?: { slug: string; fresh: boolean; res: Promise<Response | null> }
  }
}

/** Typed client for the public-api Edge Function. Auth headers come from this device. */
export function publicApi(slug: string) {
  const base = `/public-api/t/${encodeURIComponent(slug)}`
  const keyHeader = (): Record<string, string> => {
    const key = device.clientKey(slug)
    return key ? { 'x-client-key': key } : {}
  }
  const bookingAuth = (bookingId: string): Record<string, string> => {
    const token = device.bookingToken(slug, bookingId)
    return token ? { 'x-booking-token': token } : keyHeader()
  }
  return {
    /** `fresh`: skip cached copies (the owner cabinet, right after its own edits). */
    bootstrap: async (o: { fresh?: boolean } = {}) => {
      // The first load takes over the request index.html already started (once).
      const early = window.__dpBoot
      if (early && early.slug === slug && early.fresh === Boolean(o.fresh)) {
        window.__dpBoot = undefined
        const res = await early.res
        if (res?.ok) return (await res.json()) as Bootstrap
      }
      return callFunction<Bootstrap>(base, { bare: true, ...(o.fresh ? { cache: 'no-cache' as const } : {}) })
    },
    availability: (q: { serviceId: string; bodyType?: string | null; addonIds?: string[]; from: string; days: number; ignoreBooking?: string }) => {
      const p = new URLSearchParams({ service_id: q.serviceId, from: q.from, days: String(q.days) })
      if (q.bodyType) p.set('body_type', q.bodyType)
      if (q.addonIds?.length) p.set('addon_ids', q.addonIds.join(','))
      if (q.ignoreBooking) p.set('ignore_booking', q.ignoreBooking)
      return callFunction<AvailabilityResponse>(`${base}/availability?${p}`, { bare: true })
    },
    createBooking: async (body: CreateBookingRequest, idempotencyKey: string) => {
      const r = await callFunction<CreateBookingResponse>(`${base}/bookings`, {
        method: 'POST',
        json: body,
        headers: { 'idempotency-key': idempotencyKey, ...keyHeader() },
      })
      if (r.client_key) device.setClientKey(slug, r.client_key)
      device.setBookingToken(slug, r.booking.id, r.access_token)
      return r
    },
    booking: (id: string, token?: string | null) =>
      callFunction<BookingResponse>(`${base}/bookings/${id}`, { headers: token ? { 'x-booking-token': token } : bookingAuth(id) }),
    rescheduleAvailability: (id: string, from: string, days: number) =>
      callFunction<AvailabilityResponse>(`${base}/bookings/${id}/availability?from=${from}&days=${days}`, { headers: bookingAuth(id) }),
    reschedule: (id: string, startsAt: string, idempotencyKey: string) =>
      callFunction<{ booking: BookingView }>(`${base}/bookings/${id}/reschedule`, {
        method: 'POST',
        json: { starts_at: startsAt },
        headers: { 'idempotency-key': idempotencyKey, ...bookingAuth(id) },
      }),
    cancel: (id: string, reason?: string) =>
      callFunction<{ booking: BookingView }>(`${base}/bookings/${id}/cancel`, { method: 'POST', json: { reason }, headers: bookingAuth(id) }),
    calendar: (id: string) => callFunction<string>(`${base}/bookings/${id}/calendar.ics`, { headers: bookingAuth(id) }),
    profile: () => callFunction<ProfileView>(`${base}/me`, { headers: keyHeader() }),
    ensureProfile: async (idempotencyKey: string) => {
      const r = await callFunction<{ profile_id: string; client_key: string | null }>(`${base}/me`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey, ...keyHeader() },
      })
      if (r.client_key) device.setClientKey(slug, r.client_key)
      return r
    },
    updateContact: (c: { name?: string; phone?: string; email?: string | null }) =>
      callFunction<{ ok: true }>(`${base}/me`, { method: 'PATCH', json: c, headers: keyHeader() }),
    revokeProfile: () => callFunction<{ ok: true }>(`${base}/me`, { method: 'DELETE', headers: keyHeader() }),
    saveVehicle: (v: VehicleInput & { id?: string }) =>
      callFunction<{ vehicle_id: string }>(`${base}/me/vehicles`, { method: 'POST', json: v, headers: keyHeader() }),
    archiveVehicle: (id: string) => callFunction<{ ok: true }>(`${base}/me/vehicles/${id}`, { method: 'DELETE', headers: keyHeader() }),
    uploadVehiclePhoto: (id: string, blob: Blob) =>
      callFunction<{ media_id: string }>(`${base}/me/vehicles/${id}/photo`, {
        method: 'POST',
        body: blob,
        headers: { 'content-type': blob.type, ...keyHeader() },
        timeoutMs: 60_000,
      }),
    pushConfig: () => callFunction<{ enabled: boolean; vapid_public_key: string | null }>('/public-api/push/config'),
    assistant: (messages: { role: 'user' | 'assistant'; text: string }[]) =>
      callFunction<ChatResponse>(`/assistant/t/${encodeURIComponent(slug)}/chat`, {
        method: 'POST',
        json: { scope: 'client', messages },
        headers: keyHeader(),
        timeoutMs: 60_000,
      }),
    pushSubscribe: (subscription: PushSubscriptionJSON, bookingId?: string) =>
      callFunction<{ ok: true }>(`${base}/push/subscribe`, {
        method: 'POST',
        json: { subscription, booking_id: bookingId },
        headers: bookingId ? bookingAuth(bookingId) : keyHeader(),
      }),
    pushUnsubscribe: (endpoint: string) => callFunction<{ ok: true }>(`${base}/push/unsubscribe`, { method: 'POST', json: { endpoint } }),
  }
}

export type PublicApi = ReturnType<typeof publicApi>
