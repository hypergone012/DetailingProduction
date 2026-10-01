import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BODY_TYPES, businessSchema, referencedAssets, type Business } from '@dp/core'
import sharp from 'sharp'
import { z } from 'zod'

export const TENANTS_DIR = join(import.meta.dirname, '../../../tenants')

export const seedSchema = z.strictObject({
  customers: z.array(
    z.strictObject({
      name: z.string().min(1).max(120),
      phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
      email: z.email().optional(),
      vehicles: z
        .array(
          z.strictObject({
            make: z.string().min(1).max(40),
            model: z.string().min(1).max(60),
            generation: z.string().max(40).optional(),
            year: z.number().int().min(1950).max(2100).optional(),
            body_type: z.enum(BODY_TYPES),
            color: z.string().max(40).optional(),
            plate: z.string().max(16).optional(),
            nickname: z.string().max(40).optional(),
          }),
        )
        .max(5),
      visits: z
        .array(
          z.strictObject({
            service_key: z.string(),
            days_from_now: z.number().int().min(-730).max(60),
            local_time: z.string().regex(/^\d{2}:\d{2}$/),
            status: z.enum(['completed', 'cancelled', 'no_show', 'confirmed']),
            paid_method: z.enum(['cash', 'card', 'transfer', 'online', 'other']).optional(),
            client_note: z.string().max(2000).optional(),
            vehicle_index: z.number().int().min(0).optional(),
          }),
        )
        .max(50),
    }),
  ),
})
export type Seed = z.infer<typeof seedSchema>

export interface Problem {
  level: 'error' | 'warning'
  path: string
  message: string
}

export interface LoadedTenant {
  slug: string
  dir: string
  business: Business | null
  seed: Seed | null
  problems: Problem[]
}

export function tenantSlugs(): string[] {
  return readdirSync(TENANTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(TENANTS_DIR, d.name, 'business.json')))
    .map((d) => d.name)
    .sort()
}

const MIN_WIDTH: Record<string, number> = { hero: 1200, gallery: 800, service: 600 }

/** Loads and fully validates one tenant directory (schema, assets, seed). */
export async function loadTenant(slug: string, dir = join(TENANTS_DIR, slug)): Promise<LoadedTenant> {
  const problems: Problem[] = []
  const err = (path: string, message: string) => problems.push({ level: 'error', path, message })
  const warn = (path: string, message: string) => problems.push({ level: 'warning', path, message })
  const file = join(dir, 'business.json')
  if (!existsSync(file)) {
    err('business.json', 'файл не найден')
    return { slug, dir, business: null, seed: null, problems }
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    err('business.json', `невалидный JSON: ${(e as Error).message}`)
    return { slug, dir, business: null, seed: null, problems }
  }
  const parsed = businessSchema.safeParse(raw)
  if (!parsed.success) {
    for (const i of parsed.error.issues) err(i.path.join('.') || '(root)', i.message)
    return { slug, dir, business: null, seed: null, problems }
  }
  const b = parsed.data
  if (b.slug !== slug && !slug.startsWith('_')) err('slug', `slug "${b.slug}" не совпадает с папкой "${slug}"`)
  if (!b.seo.title) warn('seo.title', 'пустой — будет использовано название студии')
  if (!b.seo.description) warn('seo.description', 'пустое — будет использован слоган')
  if (b.branding.demoArtwork) warn('branding.demoArtwork', 'используются демо-иллюстрации: перед live замените фото')

  for (const asset of referencedAssets(b)) {
    const path = join(dir, asset)
    if (!existsSync(path)) {
      err(asset, 'файл не найден')
      continue
    }
    try {
      const meta = await sharp(path).metadata()
      const w = meta.width ?? 0
      const h = meta.height ?? 0
      const kind = asset === b.branding.hero ? 'hero' : b.branding.gallery.some((g) => g.src === asset) ? 'gallery' : asset === b.branding.icon ? 'icon' : asset === b.branding.logo ? 'logo' : 'service'
      if (kind === 'icon' && (w !== h || w < 512)) err(asset, `иконка должна быть квадратной и не меньше 512px (сейчас ${w}×${h})`)
      if (kind === 'logo' && meta.format !== 'svg' && Math.min(w, h) < 256) err(asset, `логотип меньше 256px (${w}×${h})`)
      const min = MIN_WIDTH[kind]
      if (min && w < min) err(asset, `ширина ${w}px, нужно не меньше ${min}px`)
      if (kind === 'hero' && w / Math.max(h, 1) < 1.2) warn(asset, 'главное фото лучше горизонтальное (соотношение от 1.2)')
    } catch {
      err(asset, 'не удалось прочитать изображение')
    }
  }

  let seed: Seed | null = null
  if (b.demo?.seedFile) {
    const seedPath = join(dir, b.demo.seedFile)
    if (!existsSync(seedPath)) err('demo.seedFile', `${b.demo.seedFile} не найден`)
    else {
      const s = seedSchema.safeParse(JSON.parse(readFileSync(seedPath, 'utf8')))
      if (!s.success) for (const i of s.error.issues) err(`${b.demo.seedFile}:${i.path.join('.')}`, i.message)
      else {
        seed = s.data
        const keys = new Set(b.services.map((x) => x.key))
        s.data.customers.forEach((c, ci) =>
          c.visits.forEach((v, vi) => {
            if (!keys.has(v.service_key)) err(`${b.demo!.seedFile}:customers.${ci}.visits.${vi}`, `нет услуги ${v.service_key}`)
            if ((v.vehicle_index ?? 0) >= c.vehicles.length) err(`${b.demo!.seedFile}:customers.${ci}.visits.${vi}`, 'vehicle_index вне списка')
          }),
        )
        if (b.status === 'live') err('demo.seedFile', 'демо-данные не загружаются в live-студию')
      }
    }
  }
  return { slug, dir, business: b, seed, problems }
}

/** Cross-tenant checks: ids and slugs are unique across the repository. */
export function crossCheck(all: LoadedTenant[]): Problem[] {
  const out: Problem[] = []
  const seen = new Map<string, string>()
  for (const t of all) {
    if (!t.business) continue
    for (const k of [`id:${t.business.id}`, `slug:${t.business.slug}`]) {
      if (seen.has(k)) out.push({ level: 'error', path: t.slug, message: `${k} уже используется в tenants/${seen.get(k)}` })
      seen.set(k, t.slug)
    }
  }
  return out
}
