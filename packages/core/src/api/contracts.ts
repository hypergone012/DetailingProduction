import { z } from 'zod'
import { BODY_TYPES, type BodyType } from '../tenant/schema.ts'

/**
 * Client API contracts (public-api Edge Function). Requests are validated with these
 * schemas on the server; the web app uses the same schemas for forms and the response
 * types for rendering. Field names are snake_case end to end (DB -> API -> UI).
 */

const id = z.uuid()
const trimmed = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()

export const vehicleInputSchema = z.strictObject({
  nickname: optionalText(40),
  make: trimmed(40),
  model: trimmed(60),
  generation: optionalText(40),
  year: z.number().int().min(1950).max(2100).nullable().optional(),
  body_type: z.enum(BODY_TYPES),
  color: optionalText(40),
  plate: optionalText(16),
  comment: z.string().trim().max(500).optional(),
})
export type VehicleInput = z.infer<typeof vehicleInputSchema>

export const contactSchema = z.strictObject({
  name: trimmed(120),
  phone: z.string().trim().min(5).max(32),
  email: z.union([z.email().max(200), z.literal('')]).nullable().optional(),
})

export const createBookingSchema = z.strictObject({
  service_id: id,
  addon_ids: z.array(id).max(20).default([]),
  starts_at: z.iso.datetime({ offset: true }),
  vehicle: z.union([z.strictObject({ id }), vehicleInputSchema]),
  contact: contactSchema,
  note: z.string().trim().max(1000).default(''),
})
export type CreateBookingRequest = z.input<typeof createBookingSchema>

export const rescheduleSchema = z.strictObject({ starts_at: z.iso.datetime({ offset: true }) })
export const cancelSchema = z.strictObject({ reason: z.string().trim().max(500).optional() })
export const contactUpdateSchema = z.strictObject({
  name: trimmed(120).optional(),
  phone: z.string().trim().min(5).max(32).optional(),
  email: z.union([z.email().max(200), z.literal('')]).nullable().optional(),
})
export const vehicleSaveSchema = vehicleInputSchema.extend({ id: id.optional() })

export const availabilityQuerySchema = z.strictObject({
  service_id: id,
  body_type: z.enum(BODY_TYPES).optional(),
  addon_ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .pipe(z.array(id).max(20)),
  from: z.iso.date(),
  days: z.coerce.number().int().min(1).max(14).default(7),
  ignore_booking: id.optional(),
})

export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  }),
})

// ---------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------

export interface MediaVariant {
  w: number
  path: string
  url?: string
  purpose?: string
}

export interface MediaView {
  id: string
  key: string | null
  kind: 'logo' | 'icon' | 'hero' | 'gallery' | 'service' | 'vehicle' | 'before' | 'after'
  bucket: 'public-media' | 'private-media'
  path: string
  url?: string
  variants: MediaVariant[]
  width: number | null
  height: number | null
  alt: string
  caption: string
  service_id: string | null
  sort_order: number
}

export interface ServiceView {
  id: string
  key: string
  name: string
  category: string
  summary: string
  description: string
  duration_min: number
  buffer_before_min: number
  buffer_after_min: number
  price_cents: number
  multi_day: boolean
  requires_confirmation: boolean
  allowed_body_types: BodyType[] | null
  benefits: string[]
  prep_notes: string[]
  restrictions: string[]
  repeat_interval_days: number | null
  recommended_ids: string[]
  variants: { body_type: BodyType; price_cents: number; duration_min: number }[]
  addons: { id: string; key: string; name: string; description: string; price_cents: number; duration_min: number }[]
}

export interface Branding {
  themePreset?: string
  accent?: string | null
  demoArtwork?: boolean
  logoKey?: string | null
  heroKey?: string | null
  iconKey?: string | null
  heroAlt?: string
}

export interface Bootstrap {
  tenant: { id: string; slug: string; name: string; status: 'demo' | 'live'; timezone: string; locale: string; currency: string }
  profile: {
    tagline: string
    description: string
    address: string
    map_url: string | null
    phone: string | null
    email: string | null
    website: string | null
    socials: { kind: string; url: string; label?: string }[]
  }
  branding: Branding
  seo: { title?: string; description?: string }
  features: { ai?: boolean; garage?: boolean; push?: boolean }
  policy: { slot_step_min: number; min_notice_min: number; horizon_days: number; cancel_cutoff_hours: number; requires_confirmation: boolean }
  hours: { weekday: number; opens: string; closes: string }[]
  exceptions: { day: string; closed: boolean; opens: string | null; closes: string | null; note: string }[]
  services: ServiceView[]
  media: MediaView[]
  /** Server capabilities (not tenant data). */
  capabilities: { ai: boolean; push: boolean }
}

export interface Slot {
  starts_at: string
  ends_at: string
  local_day: string
  local_time: string
}

export interface AvailabilityResponse {
  service_id: string
  price_cents: number
  work_minutes: number
  buffer_after_min: number
  multi_day: boolean
  currency: string
  timezone: string
  items: { kind: string; name: string; price_cents: number; minutes: number }[]
  slots: Slot[]
}

export type BookingStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'

export interface VehicleSummary {
  id: string
  nickname: string | null
  make: string
  model: string
  year: number | null
  body_type: BodyType
  color: string | null
  plate: string | null
}

export interface BookingView {
  id: string
  code: string
  status: BookingStatus
  starts_at: string
  ends_at: string
  occupied_until: string
  local_start: string
  local_end: string
  timezone: string
  service: { id: string; name: string }
  items: { kind: 'service' | 'addon' | 'adjustment'; name: string; price_cents: number; minutes: number }[]
  work_minutes: number
  buffer_before_min: number
  buffer_after_min: number
  multi_day: boolean
  price_cents: number
  currency: string
  body_type: BodyType | null
  vehicle: VehicleSummary | null
  resource: { id: string; name: string; type: string } | null
  customer_note: string
  client_note: string
  source: 'client' | 'owner' | 'assistant'
  version: number
  created_at: string
  cancelled_at: string | null
  completed_at: string | null
  is_demo: boolean
  can_modify: boolean
  modify_deadline: string
}

export interface StudioView {
  name: string
  slug: string
  address: string
  phone: string | null
  map_url: string | null
  timezone: string
  cancel_cutoff_hours: number
}

export interface BookingResponse {
  booking: BookingView
  studio: StudioView
  media: MediaView[]
}

export interface CreateBookingResponse {
  booking: BookingView
  access_token: string
  /** Present only when this request created the device profile. */
  client_key: string | null
  replayed: boolean
}

export interface BookingSummary {
  id: string
  code: string
  status: BookingStatus
  starts_at: string
  ends_at: string
  local_start: string
  service_id: string
  service_name: string
  price_cents: number
  currency: string
  vehicle_id: string | null
  client_note: string
  can_modify: boolean
  media: MediaView[]
}

export interface Suggestion {
  kind: 'repeat_due' | 'studio_recommends' | 'often_after'
  service_id: string
  service_name: string
  last_at: string | null
  customers: number | null
  after_service: string | null
}

export interface VehicleView extends VehicleSummary {
  generation: string | null
  comment: string
  created_at: string
  photo: MediaView | null
  suggestions: Suggestion[]
}

export interface ProfileView {
  profile: { id: string; display_name: string | null; phone: string | null; email: string | null; created_at: string }
  vehicles: VehicleView[]
  bookings: BookingSummary[]
}

export interface ApiErrorBody {
  error: { code: string; message: string }
}
