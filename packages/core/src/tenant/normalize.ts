import { WEEKDAYS, type Business } from './schema.ts'

/** A processed image (variants uploaded to Storage) ready to be registered as config media. */
export interface PublishedImage {
  key: string
  kind: 'logo' | 'icon' | 'hero' | 'gallery' | 'service'
  path: string
  variants: { w: number; path: string }[]
  width: number | null
  height: number | null
  alt: string
  caption: string
  service_key: string | null
  sort_order: number
}

export interface PublishMember {
  user_id: string
  role: 'owner' | 'manager' | 'staff'
}

/** Stable media key from the asset path: reordering a gallery never re-creates rows. */
export function mediaKey(kind: string, src: string): string {
  const base = src
    .replace(/^assets\//, '')
    .replace(new RegExp(`^${kind}(?:s|-images)?/`), '')
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${kind}-${base}`.slice(0, 64).replace(/-+$/, '')
}

export const cents = (v: number) => Math.round(v * 100)

/**
 * Normalized config consumed by `api_admin_publish_tenant` (snake_case, minor units,
 * ISO weekdays). Pure and deterministic: the same business.json + media + members always
 * yield the same JSON, which is what makes republishing a no-op.
 */
export function toPublishConfig(b: Business, media: PublishedImage[], members: PublishMember[]) {
  const mediaByKey = (kind: string) => media.find((m) => m.kind === kind)?.key ?? null
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    status: b.status,
    timezone: b.timezone,
    locale: b.locale,
    currency: b.currency,
    settings: {
      tagline: b.profile.tagline,
      description: b.profile.description,
      address: b.profile.address,
      map_url: b.profile.mapUrl,
      phone: b.profile.phone,
      email: b.profile.email,
      website: b.profile.website,
      socials: b.profile.socials,
      branding: {
        themePreset: b.branding.themePreset,
        accent: b.branding.accent,
        demoArtwork: b.branding.demoArtwork,
        logoKey: mediaByKey('logo'),
        heroKey: mediaByKey('hero'),
        iconKey: mediaByKey('icon'),
        heroAlt: b.branding.heroAlt,
      },
      seo: b.seo,
      features: b.features,
      policy: {
        slot_step_min: b.policy.slotStepMin,
        min_notice_min: b.policy.minNoticeMin,
        horizon_days: b.policy.horizonDays,
        cancel_cutoff_hours: b.policy.cancelCutoffHours,
        requires_confirmation: b.policy.requiresConfirmation,
        max_active_bookings_per_phone: b.policy.maxActiveBookingsPerPhone,
      },
      notifications: {
        reminder_hours_before: b.notifications.reminderHoursBefore,
        owner_push: b.notifications.ownerPush,
        client_push: b.notifications.clientPush,
      },
      ai: { daily_request_limit: b.ai.dailyRequestLimit, daily_token_budget: b.ai.dailyTokenBudget },
    },
    hours: WEEKDAYS.flatMap((day, i) =>
      (b.hours[day] ?? []).map(([opens, closes]) => ({ weekday: i + 1, opens, closes: closes === '24:00' ? '24:00' : closes })),
    ),
    exceptions: [...b.exceptions]
      .sort((x, y) => x.date.localeCompare(y.date))
      .map((e) => ({ day: e.date, closed: e.closed, opens: e.opens ?? null, closes: e.closes ?? null, note: e.note })),
    resources: b.resources.map((r, i) => ({ key: r.key, name: r.name, type: r.type, sort_order: i })),
    services: b.services.map((s, i) => ({
      key: s.key,
      name: s.name,
      category: s.category,
      summary: s.summary,
      description: s.description,
      duration_min: s.durationMin,
      buffer_before_min: s.bufferBeforeMin,
      buffer_after_min: s.bufferAfterMin,
      price_cents: cents(s.price),
      resource_types: s.resourceTypes,
      multi_day: s.multiDay,
      requires_confirmation: s.requiresConfirmation,
      allowed_body_types: s.allowedBodyTypes,
      benefits: s.benefits,
      prep_notes: s.prepNotes,
      restrictions: s.restrictions,
      recommended_keys: s.recommends,
      repeat_interval_days: s.repeatIntervalDays,
      bookable_online: s.bookableOnline,
      sort_order: i,
      variants: Object.entries(s.variants)
        .sort(([a], [z]) => a.localeCompare(z))
        .map(([body_type, v]) => ({ body_type, price_cents: cents(v!.price), duration_min: v!.durationMin })),
      addons: s.addons.map((a, j) => ({
        key: a.key,
        name: a.name,
        description: a.description,
        price_cents: cents(a.price),
        duration_min: a.durationMin,
        sort_order: j,
      })),
    })),
    media: [...media].sort((x, y) => x.key.localeCompare(y.key)),
    members,
  }
}

export type PublishConfig = ReturnType<typeof toPublishConfig>

/** Canonical JSON (sorted keys) for hashing. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
