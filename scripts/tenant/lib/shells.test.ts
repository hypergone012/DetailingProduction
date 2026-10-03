import type { Bootstrap } from '@dp/core/api/contracts'
import { HERO_IMAGE_SIZES } from '@dp/core/tenant/constants'
import { describe, expect, it } from 'vitest'
import { shellHead } from './shells.ts'

const media = (over: Record<string, unknown>) => ({ id: 'm', key: null, bucket: 'public-media', path: 'p', variants: [], width: 1, height: 1, alt: '', caption: '', service_id: null, sort_order: 0, ...over })

// Owner uploads have no key; the newest come first (negative sort_order).
const data = {
  tenant: { id: 't', slug: 'studio', name: 'Studio', status: 'live', timezone: 'Europe/Moscow', locale: 'ru-RU', currency: 'RUB' },
  branding: { themePreset: 'black', accent: null, heroKey: null, logoKey: null },
  seo: { title: 'Studio', description: 'd' },
  profile: { tagline: 't' },
  media: [
    media({ kind: 'icon', url: 'https://cdn/icon-512.png', variants: [{ w: 512, path: 'i', url: 'https://cdn/icon-512.png', purpose: 'any' }] }),
    media({
      kind: 'hero',
      url: 'https://cdn/hero-2560.webp',
      variants: [
        { w: 1280, path: 'h1', url: 'https://cdn/hero-1280.webp' },
        { w: 2560, path: 'h2', url: 'https://cdn/hero-2560.webp' },
      ],
    }),
    media({ kind: 'hero', key: 'hero-config', url: 'https://cdn/config-hero.webp' }),
  ],
} as unknown as Bootstrap

describe('shellHead', () => {
  it('previews and preloads the cover, not another keyless upload', () => {
    const { head } = shellHead(data, 'client', 'https://app.example')
    expect(head).toContain('<meta property="og:image" content="https://cdn/hero-1280.webp" />')
    expect(head).toContain('"href":"https://cdn/hero-2560.webp"')
    expect(head).toContain('"srcset":"https://cdn/hero-1280.webp 1280w, https://cdn/hero-2560.webp 2560w"')
    expect(head).toContain(JSON.stringify(HERO_IMAGE_SIZES))
    expect(head).not.toContain('icon-512.png"}')
    // only on the studio home
    expect(head).toContain('/^\\/s\\/studio\\/?$/.test(location.pathname)')
  })

  it('uses the configured cover when its key is set', () => {
    const { head } = shellHead({ ...data, branding: { ...data.branding, heroKey: 'hero-config' } } as Bootstrap, 'client', 'https://app.example')
    expect(head).toContain('"href":"https://cdn/config-hero.webp"')
  })

  it('does not preload the cover in the cabinet', () => {
    expect(shellHead(data, 'owner', 'https://app.example').head).not.toContain("rel='preload'")
  })
})
