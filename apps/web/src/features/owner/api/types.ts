import type { BookingStatus, BookingView, MediaVariant } from '@dp/core/api/contracts'
import type { BodyType } from '@dp/core/tenant/constants'

export type Role = 'owner' | 'manager' | 'staff'

export interface CalendarResource {
  id: string
  key: string
  name: string
  type: string
}

export interface CalendarBooking {
  id: string
  code: string
  status: BookingStatus
  starts_at: string
  ends_at: string
  service_id: string
  service_name: string
  price_cents: number
  currency: string
  multi_day: boolean
  source: 'client' | 'owner' | 'assistant'
  is_demo: boolean
  buffer_before_min: number
  buffer_after_min: number
  customer_note: string
  has_internal_note: boolean
  customer: { id: string; name: string; phone: string | null }
  vehicle: { id: string; make: string; model: string; plate: string | null; body_type: BodyType; color: string | null } | null
}

export interface CalendarItem {
  id: string
  kind: 'booking' | 'block'
  resource_id: string
  starts_at: string
  ends_at: string
  booking: CalendarBooking | null
  block: { reason: BlockReason; title: string | null; note: string | null } | null
}

export interface CalendarData {
  timezone: string
  from: string
  to: string
  resources: CalendarResource[]
  windows: { starts_at: string; ends_at: string }[]
  items: CalendarItem[]
}

export type BlockReason = 'maintenance' | 'closed' | 'personal' | 'reserve' | 'other'

export interface PaymentRow {
  id: string
  kind: 'payment' | 'refund'
  method: string
  amount_cents: number
  paid_at: string
  note: string
}

export interface OwnerBooking extends BookingView {
  internal_note: string
  customer_id: string
  customer: { id: string; name: string; phone: string | null; email: string | null }
  paid_cents?: number
  events: { event: string; actor: string; data: Record<string, unknown>; at: string }[]
  media: { id: string; kind: 'before' | 'after' | 'vehicle'; bucket: string; path: string; caption: string; client_visible: boolean; created_at: string }[]
  money_visible: boolean
  payments: PaymentRow[] | null
}

export interface OwnerSlot {
  starts_at: string
  ends_at: string
  local_day: string
  local_time: string
  free_resources: number
}

export interface MoneyCount {
  count: number
  value_cents: number | null
}

export interface Stats {
  period: { from: string; to: string; timezone: string }
  money_visible: boolean
  currency: string
  upcoming: MoneyCount
  scheduled: MoneyCount
  completed: MoneyCount
  cancelled: MoneyCount
  no_show: { count: number }
  payments: { received_cents: number; payments_count: number; refunds_cents: number } | null
  average_ticket_cents: number | null
  utilization: {
    booked_minutes: number
    blocked_minutes: number
    available_minutes: number
    ratio: number | null
    resources: { id: string; name: string; type: string; booked_minutes: number; blocked_minutes: number; available_minutes: number; ratio: number | null }[]
  }
  clients: { active: number; new: number; returning: number }
  daily: { day: string; bookings: number; completed_value_cents: number | null; received_cents: number | null }[]
}

export interface CustomerRow {
  id: string
  name: string
  phone_e164: string | null
  email: string | null
  owner_notes: string
  is_demo: boolean
  created_at: string
  vehicles_count: number
  bookings_count: number
  completed_count: number
  cancelled_count: number
  last_visit_at: string | null
  next_visit_at: string | null
  total_paid_cents: number
}

export interface VehicleRow {
  id: string
  customer_id: string | null
  nickname: string | null
  make: string
  model: string
  generation: string | null
  year: number | null
  body_type: BodyType
  color: string | null
  plate: string | null
  owner_notes: string
  archived_at: string | null
}

export interface BookingRow {
  id: string
  code: string
  status: BookingStatus
  starts_at: string
  ends_at: string
  service_name: string
  price_cents: number
  currency: string
  vehicle_id: string | null
  resource_id: string
  is_demo: boolean
}

export interface ServiceRow {
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
  resource_types: string[]
  multi_day: boolean
  requires_confirmation: boolean
  allowed_body_types: BodyType[] | null
  repeat_interval_days: number | null
  active: boolean
  bookable_online: boolean
  sort_order: number
  service_variants: { body_type: BodyType; price_cents: number; duration_min: number }[]
  service_addons: { id: string; key: string; name: string; description: string; price_cents: number; duration_min: number; active: boolean; sort_order: number }[]
}

export interface ResourceRow {
  id: string
  key: string
  name: string
  type: string
  active: boolean
  sort_order: number
}

export interface HoursRow {
  id: string
  weekday: number
  opens: string
  closes: string
}

export interface ExceptionRow {
  id: string
  day: string
  closed: boolean
  opens: string | null
  closes: string | null
  note: string
}

export interface SettingsRow {
  tenant_id: string
  tagline: string
  description: string
  address: string
  map_url: string | null
  phone: string | null
  email: string | null
  website: string | null
  socials: { kind: string; url: string; label?: string }[]
  branding: { themePreset?: string; accent?: string | null; demoArtwork?: boolean; logoKey?: string | null; heroKey?: string | null; heroAlt?: string }
  seo: { title?: string; description?: string }
  features: { ai?: boolean; garage?: boolean; push?: boolean }
  slot_step_min: number
  min_notice_min: number
  horizon_days: number
  cancel_cutoff_hours: number
  requires_confirmation: boolean
  max_active_bookings_per_phone: number
  reminder_hours_before: number
  notify_owner_push: boolean
  notify_client_push: boolean
}

export interface TenantRow {
  id: string
  slug: string
  name: string
  status: 'draft' | 'demo' | 'live' | 'suspended'
  timezone: string
  locale: string
  currency: string
  live_since: string | null
}

export interface MediaRow {
  id: string
  key: string | null
  kind: 'logo' | 'icon' | 'hero' | 'gallery' | 'service' | 'vehicle' | 'before' | 'after'
  bucket: 'public-media' | 'private-media'
  path: string
  variants: MediaVariant[]
  alt: string
  caption: string
  service_id: string | null
  client_visible: boolean
  sort_order: number
  source: 'config' | 'owner' | 'client'
}

export interface Readiness {
  ready: boolean
  checks: { key: string; label: string; ok: boolean }[]
}
