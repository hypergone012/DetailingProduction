/**
 * `pnpm tenant:verify`: checks what a client would actually get from a published studio,
 * through the same public endpoints the app uses. Every check performs a real request;
 * a check that cannot run is reported as skipped, never as passed.
 */
import type { AvailabilityResponse, Bootstrap } from '@dp/core/api/contracts'
import { fetchBootstrap, publishedTenants } from './shells.ts'
import { get, type Env } from './supabase.ts'
import type { LoadedTenant } from './load.ts'

export type CheckLevel = 'pass' | 'fail' | 'warn' | 'skip'
export interface Check {
  name: string
  level: CheckLevel
  detail?: string
}

const TIMEOUT_MS = 10_000

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
}

async function reachable(url: string, accept: RegExp): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url)
    const type = res.headers.get('content-type') ?? ''
    await res.body?.cancel()
    if (res.status !== 200) return `${res.status} ${url}`
    if (!accept.test(type)) return `unexpected content-type ${type} for ${url}`
    return null
  } catch (e) {
    return `${e instanceof Error ? e.message : String(e)} ${url}`
  }
}

async function allReachable(urls: string[], accept: RegExp): Promise<string[]> {
  const problems: string[] = []
  const queue = [...new Set(urls)]
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let u = queue.shift(); u; u = queue.shift()) {
        const p = await reachable(u, accept)
        if (p) problems.push(p)
      }
    }),
  )
  return problems
}

function mediaUrls(data: Bootstrap): string[] {
  return data.media.flatMap((m) => [m.url, ...m.variants.map((v) => v.url)]).filter((u): u is string => Boolean(u))
}

interface ManifestJson {
  id?: string
  scope?: string
  start_url?: string
  display?: string
  icons?: { src: string; sizes: string; purpose?: string }[]
}

function manifestProblems(m: ManifestJson, base: string): string[] {
  const out: string[] = []
  for (const k of ['id', 'scope', 'start_url'] as const) if (!m[k]?.endsWith(base)) out.push(`${k}=${m[k] ?? '∅'} (expected …${base})`)
  if (m.display !== 'standalone') out.push(`display=${m.display}`)
  const icons = m.icons ?? []
  for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']] as const) {
    if (!icons.some((i) => i.sizes === size && (i.purpose ?? 'any') === purpose)) out.push(`no ${purpose} icon ${size}`)
  }
  return out
}

async function verifyOne(env: Env, slug: string, status: string, local: LoadedTenant | undefined, appUrl: string | null): Promise<{ checks: Check[]; data: Bootstrap | null }> {
  const checks: Check[] = []
  const add = (name: string, level: CheckLevel, detail?: string) => checks.push({ name, level, detail })

  if (!local) add('config', 'warn', 'no tenants/<slug>/business.json in this checkout')
  else if (!local.business) add('config', 'fail', local.problems.filter((p) => p.level === 'error').map((p) => `${p.path}: ${p.message}`).join('; '))
  else if (local.business.status !== status) add('config', 'warn', `business.json says ${local.business.status}, database says ${status}: run pnpm tenant:publish ${slug}`)
  else add('config', 'pass', 'business.json valid and matches the database status')

  let data: Bootstrap
  try {
    data = await fetchBootstrap(env, slug)
  } catch (e) {
    add('bootstrap API', 'fail', e instanceof Error ? e.message : String(e))
    return { checks, data: null }
  }
  const bootstrapProblems: string[] = []
  if (data.tenant.slug !== slug) bootstrapProblems.push(`slug ${data.tenant.slug}`)
  if (data.services.length === 0) bootstrapProblems.push('no bookable services')
  if (data.hours.length === 0) bootstrapProblems.push('no working hours')
  const leaked = ['internal_note', 'token_hash', 'key_hash', 'service_role', 'password'].filter((k) => JSON.stringify(data).includes(k))
  if (leaked.length) bootstrapProblems.push(`private fields in public payload: ${leaked.join(', ')}`)
  add('bootstrap API', bootstrapProblems.length ? 'fail' : 'pass', bootstrapProblems.join('; ') || `${data.services.length} services, ${data.media.length} media`)

  const foreign = data.media.filter((m) => !m.path.startsWith(`${data.tenant.id}/`))
  add('media isolation', foreign.length ? 'fail' : 'pass', foreign.length ? foreign.map((m) => m.path).join(', ') : 'every object is under the studio prefix')
  const broken = await allReachable(mediaUrls(data), /^image\//)
  add('media reachable', broken.length ? 'fail' : 'pass', broken.length ? broken.slice(0, 5).join('; ') : `${new Set(mediaUrls(data)).size} files`)

  for (const app of ['client', 'owner'] as const) {
    const name = `manifest (${app}, API)`
    try {
      const url = `${env.url}/functions/v1/public-api/t/${slug}/manifest.webmanifest${app === 'owner' ? '?app=owner' : ''}`
      const res = await fetchWithTimeout(url, { headers: { apikey: env.anonKey ?? env.serviceKey } })
      if (res.status !== 200) {
        add(name, 'fail', `HTTP ${res.status}`)
        continue
      }
      const m = (await res.json()) as ManifestJson
      const problems = manifestProblems(m, app === 'client' ? `/s/${slug}/` : `/s/${slug}/owner/`)
      problems.push(...(await allReachable((m.icons ?? []).map((i) => i.src), /^image\//)))
      add(name, problems.length ? 'fail' : 'pass', problems.join('; ') || undefined)
    } catch (e) {
      add(name, 'fail', e instanceof Error ? e.message : String(e))
    }
  }

  const service = data.services[0]
  if (service) {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const a = await get<AvailabilityResponse>(env, `/functions/v1/public-api/t/${slug}/availability?service_id=${service.id}&from=${today}&days=14`)
      add('availability', a.slots.length ? 'pass' : 'warn', a.slots.length ? `${a.slots.length} slots in 14 days for «${service.name}»` : `no free slots in 14 days for «${service.name}»`)
    } catch (e) {
      add('availability', 'fail', e instanceof Error ? e.message : String(e))
    }
  }

  const owners = await get<{ user_id: string }[]>(env, `/rest/v1/tenant_members?select=user_id&tenant_id=eq.${data.tenant.id}&role=eq.owner`)
  add('owner access', owners.length ? 'pass' : 'fail', owners.length ? `${owners.length} owner(s)` : 'nobody can sign in to the cabinet')

  if (status === 'demo') {
    const sent = await get<{ id: string }[]>(env, `/rest/v1/notification_jobs?select=id&tenant_id=eq.${data.tenant.id}&status=eq.sent&limit=1`)
    const delivered = await get<{ job_id: string }[]>(env, `/rest/v1/notification_deliveries?select=job_id&tenant_id=eq.${data.tenant.id}&limit=1`)
    add('demo never notifies', sent.length || delivered.length ? 'fail' : 'pass', sent.length || delivered.length ? 'a demo studio has sent notifications' : 'no notification was sent')
  }

  if (!appUrl) {
    add('app routes', 'skip', 'pass --app-url=<served build> to check pages and shells')
  } else {
    const pages = [`/s/${slug}/`, `/s/${slug}/services`, `/s/${slug}/owner/`]
    const problems: string[] = []
    let shell = false
    for (const p of pages) {
      try {
        const res = await fetchWithTimeout(appUrl + p, { headers: { accept: 'text/html' } })
        const html = await res.text()
        if (res.status !== 200 || !html.includes('id="root"')) problems.push(`${p}: HTTP ${res.status}`)
        if (p === `/s/${slug}/` && html.includes('data-dp-static')) {
          shell = true
          if (!html.includes(`/s/${slug}/manifest.webmanifest`)) problems.push(`${p}: shell links another manifest`)
        }
      } catch (e) {
        problems.push(`${p}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    add('app routes', problems.length ? 'fail' : 'pass', problems.join('; ') || `${pages.length} pages`)
    if (shell) {
      const m = await fetchWithTimeout(`${appUrl}/s/${slug}/manifest.webmanifest`)
      const body = m.status === 200 ? ((await m.json()) as ManifestJson) : null
      const problems2 = body ? manifestProblems(body, `/s/${slug}/`) : [`HTTP ${m.status}`]
      add('static shell + manifest', problems2.length ? 'fail' : 'pass', problems2.join('; ') || undefined)
    } else {
      add('static shell + manifest', 'warn', 'served build has no static shell for this studio (pnpm tenant:shells); the app sets the manifest at runtime')
    }
  }
  return { checks, data }
}

export interface VerifyResult {
  slug: string
  checks: Check[]
}

export async function verifyTenants(
  env: Env,
  slugs: string[] | 'all',
  localBySlug: Map<string, LoadedTenant>,
  opts: { appUrl: string | null },
): Promise<VerifyResult[]> {
  const published = await publishedTenants(env)
  const status = new Map(published.map((t) => [t.slug, t.status]))
  const targets = slugs === 'all' ? published.map((t) => t.slug) : slugs
  const results: VerifyResult[] = []
  const loaded: { slug: string; data: Bootstrap }[] = []
  for (const slug of targets) {
    const st = status.get(slug)
    if (!st) {
      results.push({ slug, checks: [{ name: 'published', level: 'fail', detail: 'not published (draft, suspended or missing): run pnpm tenant:publish' }] })
      continue
    }
    const r = await verifyOne(env, slug, st, localBySlug.get(slug), opts.appUrl)
    results.push({ slug, checks: r.checks })
    if (r.data) loaded.push({ slug, data: r.data })
  }
  // Cross-studio: no service or media object may appear in two studios' public data.
  if (loaded.length > 1) {
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const { slug, data } of loaded) {
      for (const id of [...data.services.map((s) => s.id), ...data.media.map((m) => m.path)]) {
        const other = seen.get(id)
        if (other && other !== slug) clashes.push(`${id} in ${other} and ${slug}`)
        seen.set(id, slug)
      }
    }
    results.push({ slug: '(all)', checks: [{ name: 'cross-studio isolation', level: clashes.length ? 'fail' : 'pass', detail: clashes.join('; ') || `${loaded.length} studios share no services or media` }] })
  }
  return results
}
