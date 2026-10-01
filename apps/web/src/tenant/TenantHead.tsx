import type { Bootstrap } from '@dp/core/api/contracts'
import { useEffect } from 'react'
import { env } from '@/lib/env'

function upsert(selector: string, create: () => HTMLElement, apply: (el: HTMLElement) => void) {
  let el = document.head.querySelector<HTMLElement>(selector)
  if (!el) {
    el = create()
    document.head.appendChild(el)
  }
  apply(el)
}

/**
 * Per-tenant <head>. Static shells (pnpm tenant:shells) already contain these tags for
 * crawlers and installs; this keeps them correct for studios published after the last
 * deploy (manifest then comes from the API, which builds the same manifest).
 */
export function TenantHead({ data, app, title }: { data: Bootstrap; app: 'client' | 'owner'; title?: string }) {
  useEffect(() => {
    const name = data.tenant.name
    document.title = title ? `${title} · ${name}` : app === 'owner' ? `Кабинет · ${name}` : data.seo.title || name
    document.documentElement.lang = data.tenant.locale.split('-')[0] ?? 'ru'
    upsert('meta[name="description"]', () => Object.assign(document.createElement('meta'), { name: 'description' }), (el) => {
      el.setAttribute('content', data.seo.description || data.profile.tagline)
    })
    upsert('meta[name="apple-mobile-web-app-title"]', () => Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-title' }), (el) => {
      el.setAttribute('content', app === 'owner' ? `${name} · CRM` : name)
    })
    const staticManifest = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"][data-dp-static]')
    const wantStatic = staticManifest?.dataset.app === app
    if (!wantStatic) {
      upsert('link[rel="manifest"]', () => Object.assign(document.createElement('link'), { rel: 'manifest' }), (el) => {
        el.removeAttribute('data-dp-static')
        el.setAttribute('crossorigin', 'anonymous')
        el.setAttribute('href', `${env.functionsUrl}/public-api/t/${data.tenant.slug}/manifest.webmanifest${app === 'owner' ? '?app=owner' : ''}`)
      })
    }
    const icon = data.media.find((m) => m.kind === 'icon')
    const apple = icon?.variants.find((v) => v.purpose === 'apple')?.url
    const fav = icon?.variants.find((v) => v.purpose === 'favicon')?.url
    if (apple) upsert('link[rel="apple-touch-icon"]', () => Object.assign(document.createElement('link'), { rel: 'apple-touch-icon' }), (el) => el.setAttribute('href', apple))
    if (fav) upsert('link[rel="icon"]', () => Object.assign(document.createElement('link'), { rel: 'icon' }), (el) => el.setAttribute('href', fav))
  }, [data, app, title])
  return null
}
