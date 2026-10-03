/**
 * Static per-studio shells for the shared frontend build.
 *
 * The SPA is one build for every studio. Crawlers, link previews and "install app" read
 * <head> before any JavaScript runs, so each published studio gets its own copy of
 * index.html with its title, description, colors, icons and manifest, plus static
 * manifests. Nothing studio-specific is compiled into the bundle: the shells are generated
 * from the published data (the same bootstrap the app loads), after `vite build`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Bootstrap } from '@dp/core/api/contracts'
import { HERO_IMAGE_SIZES } from '@dp/core/tenant/constants'
import { buildManifest, tenantThemeColors, type ManifestInput } from '@dp/core/tenant/manifest'
import { get, type Env } from './supabase.ts'

const HEAD_RE = /<!--dp:head-->[\s\S]*?<!--\/dp:head-->/
const HTML_RE = /<html[^>]*>/

export interface PublishedTenant {
  slug: string
  status: 'demo' | 'live'
}

export async function publishedTenants(env: Env): Promise<PublishedTenant[]> {
  return get<PublishedTenant[]>(env, '/rest/v1/tenants?select=slug,status&status=in.(demo,live)&order=slug')
}

export async function fetchBootstrap(env: Env, slug: string): Promise<Bootstrap> {
  return get<Bootstrap>(env, `/functions/v1/public-api/t/${encodeURIComponent(slug)}`)
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function manifestInput(data: Bootstrap): ManifestInput {
  const icon = data.media.find((m) => m.kind === 'icon')
  return {
    slug: data.tenant.slug,
    name: data.tenant.name,
    tagline: data.profile.tagline,
    locale: data.tenant.locale,
    themePreset: data.branding.themePreset,
    accent: data.branding.accent,
    icons: (icon?.variants ?? []).filter((v) => v.url).map((v) => ({ w: v.w, url: v.url!, purpose: v.purpose })),
  }
}

export function shellHead(data: Bootstrap, app: 'client' | 'owner', appUrl: string): { head: string; htmlTag: string } {
  const name = data.tenant.name
  const colors = tenantThemeColors({ themePreset: data.branding.themePreset, accent: data.branding.accent })
  const icon = data.media.find((m) => m.kind === 'icon')
  const apple = icon?.variants.find((v) => v.purpose === 'apple')?.url
  const favicon = icon?.variants.find((v) => v.purpose === 'favicon')?.url
  // As in the app (mediaByKey): an owner's upload has no key, so a null heroKey must not match it.
  const hero = (data.branding.heroKey ? data.media.find((m) => m.key === data.branding.heroKey) : undefined) ?? data.media.find((m) => m.kind === 'hero')
  const heroUrl = hero?.variants.slice().sort((a, b) => b.w - a.w).find((v) => v.w <= 1280)?.url ?? hero?.url
  const base = app === 'client' ? `/s/${data.tenant.slug}/` : `/s/${data.tenant.slug}/owner/`
  const title = app === 'client' ? data.seo.title || name : `Кабинет · ${name}`
  const description = app === 'client' ? data.seo.description || data.profile.tagline : `Рабочий кабинет студии ${name}`
  const lines = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<meta name="theme-color" content="${colors.theme}" />`,
    `<meta name="color-scheme" content="${colors.scheme === 'dark' ? 'dark light' : 'light dark'}" />`,
    `<meta name="apple-mobile-web-app-title" content="${esc(app === 'client' ? name : `${name} · CRM`)}" />`,
    // data-icon: the page switches to the live manifest when the owner has changed the icon since.
    `<link rel="manifest" href="${base}manifest.webmanifest" data-dp-static data-app="${app}" data-icon="${esc(icon?.path ?? '')}" />`,
    apple && `<link rel="apple-touch-icon" href="${esc(apple)}" />`,
    favicon && `<link rel="icon" href="${esc(favicon)}" />`,
  ]
  if (app === 'client') {
    // The cover is the largest element of the studio home: start it with the page, not after
    // the app code and data. Only on the home (every client path serves this shell). Default
    // (low) priority: it uses spare bandwidth and never delays the app code it needs to show.
    const srcset = hero?.variants.filter((v) => v.url && !v.purpose).map((v) => `${v.url} ${v.w}w`).join(', ')
    if (hero?.url) {
      const preload = { href: hero.url, srcset: srcset ?? '', sizes: HERO_IMAGE_SIZES }
      lines.push(
        `<script>if(/^\\/s\\/${data.tenant.slug}\\/?$/.test(location.pathname)){var l=document.createElement('link');l.rel='preload';l.as='image';var p=${JSON.stringify(preload).replace(/</g, '\\u003c')};l.href=p.href;if(p.srcset){l.imageSrcset=p.srcset;l.imageSizes=p.sizes}document.head.appendChild(l)}</script>`,
      )
    }
    lines.push(
      `<link rel="canonical" href="${esc(appUrl + base)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(description)}" />`,
      `<meta property="og:url" content="${esc(appUrl + base)}" />`,
      `<meta property="og:locale" content="${esc(data.tenant.locale.replace('-', '_'))}" />`,
      heroUrl ? `<meta property="og:image" content="${esc(heroUrl)}" />` : undefined,
      `<meta name="twitter:card" content="summary_large_image" />`,
    )
  } else {
    lines.push(`<meta name="robots" content="noindex, nofollow" />`)
  }
  const lang = data.tenant.locale.split('-')[0] ?? 'ru'
  return {
    head: `<!--dp:head-->\n    ${lines.filter(Boolean).join('\n    ')}\n    <!--/dp:head-->`,
    htmlTag: `<html lang="${esc(lang)}" data-scheme="${colors.scheme}">`,
  }
}

export function renderShell(template: string, data: Bootstrap, app: 'client' | 'owner', appUrl: string): string {
  if (!HEAD_RE.test(template)) throw new Error('index.html has no <!--dp:head--> block')
  const { head, htmlTag } = shellHead(data, app, appUrl)
  return template.replace(HEAD_RE, head).replace(HTML_RE, htmlTag)
}

/**
 * Netlify / Cloudflare Pages style rewrites: every studio path serves its own shell,
 * anything else the generic one. Hosts without _redirects need the same rules in their
 * own config (see SETUP.md).
 */
export function redirectsFile(slugs: string[]): string {
  const lines = ['# generated by pnpm tenant:shells — do not edit']
  for (const slug of slugs) {
    // Static files first, explicitly: hosts differ in whether files shadow rewrites.
    lines.push(`/s/${slug}/owner/manifest.webmanifest  /s/${slug}/owner/manifest.webmanifest  200`)
    lines.push(`/s/${slug}/manifest.webmanifest  /s/${slug}/manifest.webmanifest  200`)
    lines.push(`/s/${slug}/owner/*  /s/${slug}/owner/index.html  200`)
    lines.push(`/s/${slug}/*  /s/${slug}/index.html  200`)
  }
  lines.push('/*  /index.html  200')
  return lines.join('\n') + '\n'
}

export interface ShellReport {
  slug: string
  files: string[]
}

export async function writeShells(env: Env, distDir: string, log: (m: string) => void): Promise<ShellReport[]> {
  const indexPath = join(distDir, 'index.html')
  if (!existsSync(indexPath)) throw new Error(`${indexPath} not found: run pnpm build first`)
  const template = readFileSync(indexPath, 'utf8')
  const tenants = await publishedTenants(env)
  const reports: ShellReport[] = []
  for (const t of tenants) {
    const data = await fetchBootstrap(env, t.slug)
    const files: string[] = []
    for (const app of ['client', 'owner'] as const) {
      const dir = app === 'client' ? join(distDir, 's', t.slug) : join(distDir, 's', t.slug, 'owner')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.html'), renderShell(template, data, app, env.appUrl))
      writeFileSync(join(dir, 'manifest.webmanifest'), JSON.stringify(buildManifest(manifestInput(data), env.appUrl, app), null, 2))
      files.push(`${dir}/index.html`, `${dir}/manifest.webmanifest`)
    }
    reports.push({ slug: t.slug, files })
    log(`✓ ${t.slug} (${t.status}): client + owner shells and manifests`)
  }
  // dist/s/ holds nothing but these shells: a studio that was deleted, unpublished or
  // renamed must not keep a page and an installable manifest on the static host.
  const published = new Set(tenants.map((t) => t.slug))
  for (const slug of existsSync(join(distDir, 's')) ? readdirSync(join(distDir, 's')) : []) {
    if (published.has(slug)) continue
    rmSync(join(distDir, 's', slug), { recursive: true, force: true })
    log(`✓ removed stale shell s/${slug}`)
  }
  writeFileSync(join(distDir, '_redirects'), redirectsFile(tenants.map((t) => t.slug)))
  log(`✓ _redirects (${tenants.length} studio(s))`)
  return reports
}
