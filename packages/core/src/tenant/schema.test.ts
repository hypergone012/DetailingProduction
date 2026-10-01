import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalJson, mediaKey, toPublishConfig } from './normalize.ts'
import { businessSchema, type BusinessInput } from './schema.ts'

const TENANTS = join(import.meta.dirname, '../../../../tenants')
const read = (slug: string) => JSON.parse(readFileSync(join(TENANTS, slug, 'business.json'), 'utf8')) as BusinessInput

const minimal = (): BusinessInput => ({
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'studio',
  name: 'Studio',
  timezone: 'Europe/Moscow',
  profile: {},
  branding: { themePreset: 'graphite', logo: 'assets/logo.svg', hero: 'assets/hero.jpg' },
  hours: { mon: [['09:00', '18:00']] },
  resources: [{ key: 'bay-1', name: 'Бокс', type: 'detail_bay' }],
  services: [{ key: 'wash', name: 'Мойка', durationMin: 60, price: 1000, resourceTypes: ['detail_bay'] }],
  owners: [{ email: 'o@example.com' }],
})

const issues = (input: unknown) => {
  const r = businessSchema.safeParse(input)
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
}

describe('business.json schema', () => {
  it('accepts every tenant in the repository (incl. the template)', () => {
    const dirs = readdirSync(TENANTS, { withFileTypes: true }).filter((d) => d.isDirectory())
    expect(dirs.length).toBeGreaterThanOrEqual(3)
    for (const d of dirs) expect(issues(read(d.name)), d.name).toEqual([])
  })

  it('applies defaults', () => {
    const b = businessSchema.parse(minimal())
    expect(b.status).toBe('demo')
    expect(b.policy.slotStepMin).toBe(30)
    expect(b.services[0]!.bufferAfterMin).toBe(0)
    expect(b.features).toEqual({ ai: true, garage: true, push: true })
  })

  it('rejects unknown keys (typos never pass silently)', () => {
    expect(issues({ ...minimal(), colour: '#fff' }).join()).toMatch(/colour/)
  })

  it('rejects services pointing at missing resource types or services', () => {
    const b = minimal()
    b.services[0]!.resourceTypes = ['ppf_booth']
    b.services[0]!.recommends = ['ghost']
    const out = issues(b).join('\n')
    expect(out).toMatch(/нет ресурса типа "ppf_booth"/)
    expect(out).toMatch(/нет услуги "ghost"/)
  })

  it('rejects overlapping hours, duplicate keys and long non multi-day jobs', () => {
    const b = minimal()
    b.hours = { mon: [['09:00', '14:00'], ['13:00', '18:00']] }
    b.resources.push({ key: 'bay-1', name: 'Дубль', type: 'detail_bay' })
    b.services[0]!.durationMin = 26 * 60
    const out = issues(b).join('\n')
    expect(out).toMatch(/пересекаются/)
    expect(out).toMatch(/повторяется ключ ресурса/)
    expect(out).toMatch(/multiDay/)
  })

  it('rejects acid accents and unknown presets', () => {
    expect(issues({ ...minimal(), branding: { ...minimal().branding, accent: '#ff0000' } }).join()).toMatch(/кислотный/)
    expect(issues({ ...minimal(), branding: { ...minimal().branding, accent: '#00ff00' } }).join()).toMatch(/кислотный/)
    expect(issues({ ...minimal(), branding: { ...minimal().branding, themePreset: 'neon' } }).length).toBeGreaterThan(0)
  })

  it('refuses a live studio on demo artwork or without contacts', () => {
    const out = issues({ ...minimal(), status: 'live', branding: { ...minimal().branding, demoArtwork: true } }).join('\n')
    expect(out).toMatch(/демо-иллюстрациях/)
    expect(out).toMatch(/телефон/)
  })

  it('rejects reserved slugs and bad timezones', () => {
    expect(issues({ ...minimal(), slug: 'owner' }).join()).toMatch(/зарезервированный/)
    expect(issues({ ...minimal(), timezone: 'Mars/Olympus' }).join()).toMatch(/timezone/)
  })
})

describe('normalization', () => {
  it('is deterministic and uses minor units and ISO weekdays', () => {
    const b = businessSchema.parse(read('graphite'))
    const a = toPublishConfig(b, [], [])
    const c = toPublishConfig(businessSchema.parse(read('graphite')), [], [])
    expect(canonicalJson(a)).toBe(canonicalJson(c))
    expect(a.services[0]!.price_cents).toBe(350000)
    expect(a.hours.find((h) => h.weekday === 7)).toEqual({ weekday: 7, opens: '10:00', closes: '18:00' })
    expect(a.services.find((s) => s.key === 'ceramic-3-layers')!.variants.map((v) => v.body_type)).toEqual(['large_suv', 'suv'])
  })

  it('derives stable media keys from asset paths', () => {
    expect(mediaKey('gallery', 'assets/gallery/Paint Shot.jpg')).toBe('gallery-paint-shot')
    expect(mediaKey('service', 'assets/services/wash.jpg')).toBe('service-wash')
    expect(mediaKey('hero', 'assets/hero.jpg')).toBe('hero-hero')
  })

  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(canonicalJson({ a: [{ x: 1, y: 2 }], b: 1 }))
  })
})
