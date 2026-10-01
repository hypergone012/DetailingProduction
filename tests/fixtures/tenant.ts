/** Tenant configs for tests: the same normalized shape `tenant:publish` sends to SQL. */
type Row = Record<string, unknown>

export interface ServiceFixture {
  key: string
  name?: string
  duration_min: number
  price_cents: number
  buffer_before_min?: number
  buffer_after_min?: number
  resource_types?: string[]
  multi_day?: boolean
  requires_confirmation?: boolean
  variants?: { body_type: string; price_cents: number; duration_min: number }[]
  addons?: { key: string; name: string; price_cents: number; duration_min: number }[]
  repeat_interval_days?: number | null
  recommended_keys?: string[]
}

export interface TenantOptions {
  slug?: string
  name?: string
  timezone?: string
  status?: 'draft' | 'demo' | 'live'
  hours?: { weekday: number; opens: string; closes: string }[]
  exceptions?: { day: string; closed: boolean; opens?: string | null; closes?: string | null; note?: string }[]
  resources?: { key: string; name: string; type: string }[]
  services?: ServiceFixture[]
  policy?: Partial<{
    slot_step_min: number
    min_notice_min: number
    horizon_days: number
    cancel_cutoff_hours: number
    requires_confirmation: boolean
    max_active_bookings_per_phone: number
  }>
}

export interface Tenant {
  id: string
  slug: string
  timezone: string
  ownerId: string
  config: Row
  services: Record<string, string>
  addons: Record<string, string>
  resources: Record<string, string>
}

export const everyDay = (opens = '09:00', closes = '21:00') =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens, closes }))

export function tenantConfig(id: string, ownerId: string, o: TenantOptions = {}): Row {
  const slug = o.slug ?? `t-${id.slice(0, 8)}`
  return {
    id,
    slug,
    name: o.name ?? `Test ${slug}`,
    status: o.status ?? 'live',
    timezone: o.timezone ?? 'Europe/Moscow',
    locale: 'ru-RU',
    currency: 'RUB',
    settings: {
      tagline: 'Test studio',
      description: '',
      address: 'Test street 1',
      map_url: null,
      phone: '+74950000000',
      email: null,
      website: null,
      socials: [],
      branding: { themePreset: 'black', demoArtwork: false },
      seo: {},
      features: { ai: true },
      policy: {
        slot_step_min: 30,
        min_notice_min: 60,
        horizon_days: 120,
        cancel_cutoff_hours: 24,
        requires_confirmation: false,
        max_active_bookings_per_phone: 10,
        ...o.policy,
      },
      notifications: { reminder_hours_before: 24, owner_push: true, client_push: true },
      ai: { daily_request_limit: 5, daily_token_budget: 100000 },
    },
    hours: o.hours ?? everyDay(),
    exceptions: (o.exceptions ?? []).map((e) => ({ opens: null, closes: null, note: '', ...e })),
    resources: (o.resources ?? [{ key: 'bay-1', name: 'Бокс 1', type: 'detail_bay' }]).map((r, i) => ({ ...r, sort_order: i })),
    services: (
      o.services ?? [
        {
          key: 'wash',
          duration_min: 60,
          buffer_after_min: 30,
          price_cents: 300000,
          variants: [{ body_type: 'suv', price_cents: 400000, duration_min: 90 }],
          addons: [{ key: 'wheels', name: 'Диски', price_cents: 150000, duration_min: 30 }],
          repeat_interval_days: 30,
        },
      ]
    ).map((s, i) => ({
      name: s.key,
      category: 'other',
      summary: '',
      description: '',
      buffer_before_min: 0,
      buffer_after_min: 0,
      resource_types: ['detail_bay'],
      multi_day: false,
      requires_confirmation: false,
      allowed_body_types: null,
      benefits: [],
      prep_notes: [],
      restrictions: [],
      recommended_keys: [],
      repeat_interval_days: null,
      bookable_online: true,
      sort_order: i,
      variants: [],
      addons: [],
      ...s,
    })),
    media: [],
    members: [{ user_id: ownerId, role: 'owner' }],
  }
}

