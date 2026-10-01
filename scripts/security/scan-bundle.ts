/**
 * `pnpm security:scan-bundle`: what ships to browsers must contain no secret and no studio.
 *
 *   1. Every file of the web build (JS, CSS, HTML, source maps, service worker) is searched
 *      for server secrets: the actual values of server-only variables (from the environment
 *      and the local stack files), JWTs whose role is not `anon`, private keys, API-key
 *      shaped strings and server-only variable names.
 *   2. White-label: the shared build and the shared source code must not name any studio
 *      (slug or name from tenants/*). Per-studio shells under dist/s/ are generated from
 *      published data and are excluded on purpose.
 *
 * Usage: pnpm build && pnpm security:scan-bundle [--dist=apps/web/dist]
 * Exit code 1 on any finding.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = join(import.meta.dirname, '../..')
const distArg = process.argv.find((a) => a.startsWith('--dist='))?.slice('--dist='.length)
const DIST = distArg ? resolve(distArg) : join(ROOT, 'apps/web/dist')

/** Variables that must never reach a browser. */
const SERVER_ONLY = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'ACCESS_TOKEN_SECRET',
  'DISPATCHER_SECRET',
  'VAPID_PRIVATE_KEY',
  'LLM_API_KEY',
  'JWT_SECRET',
  'TENANT_DEMO_OWNER_PASSWORD',
]

interface Finding {
  file: string
  what: string
}

function walk(dir: string, skip: (rel: string) => boolean = () => false): string[] {
  const out: string[] = []
  const visit = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      const rel = relative(dir, full)
      if (skip(rel)) continue
      if (statSync(full).isDirectory()) visit(full)
      else out.push(full)
    }
  }
  visit(dir)
  return out
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '')
  }
  return out
}

/** Real secret values known on this machine (CI passes them as environment variables). */
function secretValues(): Map<string, string> {
  const values = new Map<string, string>()
  const sources: Record<string, string>[] = [
    process.env as Record<string, string>,
    parseEnvFile(join(ROOT, '.local/functions.env')),
    parseEnvFile(join(ROOT, '.env')),
  ]
  const keysFile = join(ROOT, '.local/keys.json')
  if (existsSync(keysFile)) {
    const k = JSON.parse(readFileSync(keysFile, 'utf8')) as { serviceRoleKey?: string; jwtSecret?: string }
    sources.push({ SUPABASE_SERVICE_ROLE_KEY: k.serviceRoleKey ?? '', JWT_SECRET: k.jwtSecret ?? '' })
  }
  for (const src of sources) {
    for (const name of SERVER_ONLY) {
      const v = src[name]
      if (v && v.length >= 12) values.set(`${name}:${v.slice(0, 6)}`, v)
    }
  }
  return values
}

function jwtRole(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { role?: string }
    return payload.role ?? null
  } catch {
    return null
  }
}

const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'PEM private key'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'API key shaped string (sk-…)'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key shaped string'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/"d"\s*:\s*"[A-Za-z0-9_-]{43}"/, 'JWK private component (d)'],
]

function scanBuild(findings: Finding[]) {
  if (!existsSync(DIST)) {
    console.error(`✗ ${DIST} not found: run pnpm build first`)
    process.exit(1)
  }
  const secrets = secretValues()
  const files = walk(DIST, (rel) => rel === 's' || rel.startsWith('s/'))
  for (const file of files) {
    const rel = relative(ROOT, file)
    const text = readFileSync(file, 'utf8')
    for (const [label, value] of secrets) {
      if (text.includes(value)) findings.push({ file: rel, what: `value of ${label.split(':')[0]}` })
    }
    for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
      const role = jwtRole(m[0])
      if (role !== 'anon') findings.push({ file: rel, what: `JWT with role ${role ?? 'unknown'}` })
    }
    for (const [re, label] of PATTERNS) if (re.test(text)) findings.push({ file: rel, what: label })
    for (const name of SERVER_ONLY) if (text.includes(name)) findings.push({ file: rel, what: `server-only variable name ${name}` })
    if (/VITE_[A-Z_]*(SECRET|SERVICE|PRIVATE|LLM)/.test(text)) findings.push({ file: rel, what: 'secret-looking VITE_ variable' })
  }
  return files.length
}

/** Studio identities from tenants/*: slugs (as words) and names. */
function studioMarkers(): { slug: string; markers: string[] }[] {
  const dir = join(ROOT, 'tenants')
  const out: { slug: string; markers: string[] }[] = []
  for (const slug of readdirSync(dir)) {
    const file = join(dir, slug, 'business.json')
    if (slug.startsWith('_') || !existsSync(file)) continue
    const b = JSON.parse(readFileSync(file, 'utf8')) as { slug?: string; name?: string }
    const markers = [b.slug ?? slug, b.name].filter((v): v is string => Boolean(v && v.length >= 3))
    // The first word of a brand name ("GRAPHITE" in "GRAPHITE Detailing") is its identity.
    const first = b.name?.split(/\s+/)[0]
    if (first && first.length >= 4) markers.push(first)
    out.push({ slug, markers: [...new Set(markers)] })
  }
  return out
}

function containsMarker(text: string, marker: string): boolean {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`, 'i').test(text)
}

function scanWhiteLabel(findings: Finding[]) {
  const studios = studioMarkers()
  const sharedSource = [
    ...walk(join(ROOT, 'apps/web/src')),
    ...walk(join(ROOT, 'packages/core/src'), (rel) => rel.endsWith('.test.ts')),
    ...walk(join(ROOT, 'supabase/functions'), (rel) => rel.startsWith('_vendor')),
    ...walk(join(ROOT, 'supabase/migrations')),
    join(ROOT, 'apps/web/index.html'),
  ]
  const build = walk(DIST, (rel) => rel === 's' || rel.startsWith('s/') || rel.endsWith('.map') || rel === '_redirects')
  for (const file of [...sharedSource, ...build]) {
    const text = readFileSync(file, 'utf8')
    for (const s of studios) {
      for (const marker of s.markers) {
        if (containsMarker(text, marker)) findings.push({ file: relative(ROOT, file), what: `names studio "${s.slug}" (${marker})` })
      }
    }
  }
  return { studios: studios.length, files: sharedSource.length + build.length }
}

const findings: Finding[] = []
const scanned = scanBuild(findings)
const wl = scanWhiteLabel(findings)
if (findings.length) {
  for (const f of findings) console.error(`✗ ${f.file}: ${f.what}`)
  console.error(`\n${findings.length} finding(s)`)
  process.exit(1)
}
console.log(`✓ no secrets in ${scanned} build files (dist/s/ shells excluded)`)
console.log(`✓ no studio names in shared source or build (${wl.studios} studios, ${wl.files} files)`)
