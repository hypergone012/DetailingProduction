import { z } from 'zod'
import { contrast, isHarsh, isHex } from '../theme/color.ts'
import { THEME_PRESET_IDS, THEME_PRESETS, resolveTheme } from '../theme/presets.ts'

/**
 * business.json — the input of the tenant pipeline (tenants/<slug>/business.json).
 * Human-friendly units: prices in currency units, durations in minutes, local wall-clock
 * hours. After `tenant:publish` the database is the runtime source of truth; this file is
 * never read by the running app.
 */

export const BODY_TYPES = ['hatchback', 'sedan', 'coupe', 'crossover', 'suv', 'large_suv', 'minivan', 'pickup'] as const
export type BodyType = (typeof BODY_TYPES)[number]

export const BODY_TYPE_LABELS: Record<BodyType, string> = {
  hatchback: 'Хэтчбек',
  sedan: 'Седан / универсал',
  coupe: 'Купе / кабриолет',
  crossover: 'Кроссовер',
  suv: 'Внедорожник',
  large_suv: 'Большой внедорожник',
  minivan: 'Минивэн / фургон',
  pickup: 'Пикап',
}

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'ключ: латиница в нижнем регистре, цифры и дефис')
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'время в формате HH:MM')
const assetPath = z.string().regex(/^assets\/[A-Za-z0-9/_.-]+\.(?:svg|png|jpe?g|webp|avif)$/, 'путь вида assets/<файл>.(svg|png|jpg|webp|avif)')
const httpsUrl = z.url({ protocol: /^https$/ })
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/, 'телефон в формате E.164, например +74951234567')
const money = z.number().nonnegative().max(100_000_000).refine((v) => Math.round(v * 100) === v * 100, 'не больше двух знаков после запятой')
const minutes = (max: number) => z.number().int().min(0).max(max)
const color = z.string().refine(isHex, 'цвет в формате #RRGGBB')

const image = z.strictObject({
  src: assetPath,
  alt: z.string().max(200).default(''),
  caption: z.string().max(200).default(''),
})

const service = z.strictObject({
  key,
  name: z.string().min(1).max(80),
  category: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).default('other'),
  summary: z.string().max(200).default(''),
  description: z.string().max(4000).default(''),
  durationMin: z.number().int().min(5).max(20160),
  bufferBeforeMin: minutes(240).default(0),
  bufferAfterMin: minutes(240).default(0),
  price: money,
  resourceTypes: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)).min(1).max(10),
  multiDay: z.boolean().default(false),
  requiresConfirmation: z.boolean().default(false),
  allowedBodyTypes: z.array(z.enum(BODY_TYPES)).min(1).nullable().default(null),
  benefits: z.array(z.string().min(1).max(160)).max(12).default([]),
  prepNotes: z.array(z.string().min(1).max(240)).max(8).default([]),
  restrictions: z.array(z.string().min(1).max(240)).max(8).default([]),
  recommends: z.array(key).max(6).default([]),
  repeatIntervalDays: z.number().int().min(7).max(1095).nullable().default(null),
  bookableOnline: z.boolean().default(true),
  variants: z.partialRecord(z.enum(BODY_TYPES), z.strictObject({ price: money, durationMin: z.number().int().min(5).max(20160) })).default({}),
  addons: z
    .array(
      z.strictObject({
        key,
        name: z.string().min(1).max(80),
        description: z.string().max(500).default(''),
        price: money,
        durationMin: minutes(1440).default(0),
      }),
    )
    .max(20)
    .default([]),
  images: z.array(image).max(8).default([]),
})

export const businessSchema = z
  .strictObject({
    $schema: z.string().optional(),
    id: z.uuid(),
    slug: z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'slug: 1-40 символов, латиница, цифры, дефис')
      .refine((s) => !['owner', 'api', 'admin', 'assets', 'static', 'www', 'app', 'new', 's', 't'].includes(s), 'зарезервированный slug'),
    name: z.string().min(1).max(80),
    status: z.enum(['draft', 'demo', 'live']).default('demo'),
    timezone: z.string().refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz })
        return true
      } catch {
        return false
      }
    }, 'неизвестная IANA timezone'),
    locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default('ru-RU'),
    currency: z.string().regex(/^[A-Z]{3}$/).default('RUB'),
    profile: z.strictObject({
      tagline: z.string().max(160).default(''),
      description: z.string().max(4000).default(''),
      address: z.string().max(300).default(''),
      mapUrl: httpsUrl.nullable().default(null),
      phone: phone.nullable().default(null),
      email: z.email().nullable().default(null),
      website: httpsUrl.nullable().default(null),
      socials: z
        .array(z.strictObject({ kind: z.enum(['telegram', 'whatsapp', 'vk', 'instagram', 'youtube', 'website', 'other']), url: httpsUrl, label: z.string().max(40).optional() }))
        .max(8)
        .default([]),
    }),
    branding: z.strictObject({
      themePreset: z.enum(THEME_PRESET_IDS),
      accent: color.nullable().default(null),
      logo: assetPath,
      icon: assetPath.nullable().default(null),
      hero: assetPath,
      heroAlt: z.string().max(200).default(''),
      gallery: z.array(image).max(24).default([]),
      demoArtwork: z.boolean().default(false),
    }),
    seo: z.strictObject({ title: z.string().max(70).default(''), description: z.string().max(170).default('') }).default({ title: '', description: '' }),
    features: z.strictObject({ ai: z.boolean().default(true), garage: z.boolean().default(true), push: z.boolean().default(true) }).default({ ai: true, garage: true, push: true }),
    policy: z
      .strictObject({
        slotStepMin: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]).default(30),
        minNoticeMin: minutes(10080).default(120),
        horizonDays: z.number().int().min(1).max(365).default(45),
        cancelCutoffHours: z.number().int().min(0).max(336).default(24),
        requiresConfirmation: z.boolean().default(false),
        maxActiveBookingsPerPhone: z.number().int().min(1).max(50).default(3),
      })
      .default({ slotStepMin: 30, minNoticeMin: 120, horizonDays: 45, cancelCutoffHours: 24, requiresConfirmation: false, maxActiveBookingsPerPhone: 3 }),
    notifications: z
      .strictObject({ ownerPush: z.boolean().default(true), clientPush: z.boolean().default(true), reminderHoursBefore: z.number().int().min(1).max(168).default(24) })
      .default({ ownerPush: true, clientPush: true, reminderHoursBefore: 24 }),
    ai: z
      .strictObject({ dailyRequestLimit: z.number().int().min(0).max(100000).default(300), dailyTokenBudget: z.number().int().min(0).max(100_000_000).default(300000) })
      .default({ dailyRequestLimit: 300, dailyTokenBudget: 300000 }),
    hours: z.partialRecord(z.enum(WEEKDAYS), z.array(z.tuple([time, time])).max(4)),
    exceptions: z
      .array(
        z.strictObject({
          date: z.iso.date(),
          closed: z.boolean(),
          opens: time.optional(),
          closes: time.optional(),
          note: z.string().max(200).default(''),
        }),
      )
      .max(200)
      .default([]),
    resources: z
      .array(z.strictObject({ key, name: z.string().min(1).max(60), type: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/) }))
      .min(1)
      .max(50),
    services: z.array(service).min(1).max(100),
    owners: z.array(z.strictObject({ email: z.email(), role: z.enum(['owner', 'manager', 'staff']).default('owner') })).min(1),
    demo: z.strictObject({ seedFile: z.string().regex(/^[A-Za-z0-9_.-]+\.json$/).optional() }).optional(),
  })
  .superRefine((b, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    const dupes = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i)

    for (const d of dupes(b.resources.map((r) => r.key))) issue(['resources'], `повторяется ключ ресурса "${d}"`)
    for (const d of dupes(b.services.map((s) => s.key))) issue(['services'], `повторяется ключ услуги "${d}"`)
    for (const d of dupes(b.exceptions.map((e) => e.date))) issue(['exceptions'], `повторяется дата исключения ${d}`)

    const types = new Set(b.resources.map((r) => r.type))
    const serviceKeys = new Set(b.services.map((s) => s.key))
    b.services.forEach((s, i) => {
      for (const t of s.resourceTypes) if (!types.has(t)) issue(['services', i, 'resourceTypes'], `нет ресурса типа "${t}"`)
      for (const r of s.recommends) {
        if (!serviceKeys.has(r)) issue(['services', i, 'recommends'], `нет услуги "${r}"`)
        if (r === s.key) issue(['services', i, 'recommends'], 'услуга не может рекомендовать себя')
      }
      for (const d of dupes(s.addons.map((a) => a.key))) issue(['services', i, 'addons'], `повторяется ключ опции "${d}"`)
      if (!s.multiDay && s.durationMin > 24 * 60) issue(['services', i, 'durationMin'], 'работа дольше суток должна быть multiDay')
    })

    for (const [day, windows] of Object.entries(b.hours)) {
      const spans = (windows ?? []).map(([o, c]) => {
        const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
        const start = toMin(o)
        let end = toMin(c)
        if (end <= start) end += 24 * 60
        return [start, end] as const
      })
      ;(windows ?? []).forEach(([o, c], i) => {
        if (o === c) issue(['hours', day, i], 'открытие и закрытие совпадают')
      })
      spans.forEach(([s1, e1], i) =>
        spans.forEach(([s2, e2], j) => {
          if (i < j && s1 < e2 && s2 < e1) issue(['hours', day], 'интервалы пересекаются')
        }),
      )
    }
    if (Object.values(b.hours).every((w) => !w || w.length === 0)) issue(['hours'], 'нужен хотя бы один рабочий интервал')

    b.exceptions.forEach((e, i) => {
      if (e.closed && (e.opens || e.closes)) issue(['exceptions', i], 'у закрытого дня не указывают часы')
      if (!e.closed && (!e.opens || !e.closes)) issue(['exceptions', i], 'для сокращённого дня нужны opens и closes')
    })

    if (b.branding.accent) {
      if (isHarsh(b.branding.accent)) issue(['branding', 'accent'], 'слишком кислотный цвет: выберите глубокий или приглушённый оттенок')
      const t = resolveTheme(b.branding.themePreset, b.branding.accent)
      if (contrast(t.accentContrast, t.accent) < 4.5) issue(['branding', 'accent'], 'недостаточный контраст текста на акцентном цвете')
      if (contrast(b.branding.accent, THEME_PRESETS[b.branding.themePreset].tokens.bg) < 1.6)
        issue(['branding', 'accent'], 'акцент почти не отличается от фона темы')
    }

    if (b.status === 'live') {
      if (b.branding.demoArtwork) issue(['branding', 'demoArtwork'], 'live-студия не может работать на демо-иллюстрациях')
      if (!b.profile.phone) issue(['profile', 'phone'], 'для live нужен телефон')
      if (!b.profile.address) issue(['profile', 'address'], 'для live нужен адрес')
      if (!b.owners.some((o) => o.role === 'owner')) issue(['owners'], 'нужен владелец')
    }
  })

export type BusinessInput = z.input<typeof businessSchema>
export type Business = z.output<typeof businessSchema>
export type BusinessService = Business['services'][number]

/** Every asset path referenced by a config (for existence checks and uploads). */
export function referencedAssets(b: Business): string[] {
  const out = [b.branding.logo, b.branding.hero, ...b.branding.gallery.map((g) => g.src), ...b.services.flatMap((s) => s.images.map((i) => i.src))]
  if (b.branding.icon) out.push(b.branding.icon)
  return [...new Set(out)]
}
