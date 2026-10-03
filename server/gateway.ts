/**
 * The platform's front door — one origin for everything, in development and on the server:
 *   /auth/v1/*      -> GoTrue      (DP_AUTH_PORT, default 54324)
 *   /rest/v1/*      -> PostgREST   (DP_REST_PORT, default 54325)
 *   /storage/v1/*   -> Storage API (DP_STORAGE_PORT, default 54326)
 *   /functions/v1/<name>/* -> supabase/functions/<name>/handler.ts, run in this Deno process
 *                     exactly as the Edge Runtime would call `Deno.serve(handler)`
 *   anything else   -> the built web app (DP_WEB_ROOT), with every studio's own shell
 *                     (server/web-rules.ts); without DP_WEB_ROOT: 404 (development: Vite serves)
 *
 * Like the hosted Supabase gateway it requires a valid project key (`apikey`) for auth/rest/
 * storage and verifies the bearer JWT for functions that declare verify_jwt (config.toml).
 *
 * Keys: DP_ANON_KEY, DP_SERVICE_ROLE_KEY, DP_JWT_SECRET (the server: /etc/dp/dp.env). When they
 * are not set (development), .local/keys.json and .local/functions.env are used.
 *
 * Development: pnpm functions:serve. Server: systemd unit dp-gateway (deploy/server).
 */
import { jwtVerify } from 'npm:jose@6.2.12'
import { contentType, headersFor, parseHeadersFile, resolveWebPath, type HeaderRule } from './web-rules.ts'

const env = (k: string) => {
  const v = Deno.env.get(k)
  return v && v.trim() !== '' ? v.trim() : undefined
}

const PORT = Number(env('DP_GATEWAY_PORT') ?? 54321)
const HOST = env('DP_GATEWAY_HOST') ?? '127.0.0.1'
const UPSTREAMS: Record<string, string> = {
  '/auth/v1': `http://127.0.0.1:${env('DP_AUTH_PORT') ?? 54324}`,
  '/rest/v1': `http://127.0.0.1:${env('DP_REST_PORT') ?? 54325}`,
  '/storage/v1': `http://127.0.0.1:${env('DP_STORAGE_PORT') ?? 54326}`,
}
// Functions that verify the caller's JWT before the handler runs (mirrors config.toml).
const VERIFY_JWT: Record<string, boolean> = {
  'public-api': false,
  'owner-api': true,
  assistant: false,
  'notify-dispatcher': false,
}

interface Keys {
  url: string
  anonKey: string
  serviceRoleKey: string
  jwtSecret: string
}

async function loadKeys(): Promise<Keys> {
  const anonKey = env('DP_ANON_KEY')
  const serviceRoleKey = env('DP_SERVICE_ROLE_KEY')
  const jwtSecret = env('DP_JWT_SECRET')
  if (anonKey && serviceRoleKey && jwtSecret) return { url: env('SUPABASE_URL') ?? `http://127.0.0.1:${PORT}`, anonKey, serviceRoleKey, jwtSecret }
  // Development: the local stack's keys and function secrets (pnpm stack:env).
  const local = JSON.parse(await Deno.readTextFile(new URL('../.local/keys.json', import.meta.url))) as Keys
  const keys = { ...local, anonKey: anonKey ?? local.anonKey, serviceRoleKey: serviceRoleKey ?? local.serviceRoleKey, jwtSecret: jwtSecret ?? local.jwtSecret }
  try {
    for (const line of (await Deno.readTextFile(new URL('../.local/functions.env', import.meta.url))).split('\n')) {
      const i = line.indexOf('=')
      if (i > 0 && !line.startsWith('#') && !env(line.slice(0, i))) Deno.env.set(line.slice(0, i), line.slice(i + 1))
    }
  } catch {
    console.warn('no .local/functions.env — run `pnpm stack:env`')
  }
  return keys
}

const keys = await loadKeys()
const defaults: Record<string, string> = {
  SUPABASE_URL: keys.url,
  SUPABASE_ANON_KEY: keys.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: keys.serviceRoleKey,
  SUPABASE_JWT_ISSUER: `${keys.url}/auth/v1`,
}
for (const [k, v] of Object.entries(defaults)) if (!env(k)) Deno.env.set(k, v)
const secret = new TextEncoder().encode(keys.jwtSecret)
const projectKeys = new Set([keys.anonKey, keys.serviceRoleKey])

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, x-supabase-api-version, apikey, content-type, x-upsert, range, prefer, accept-profile, content-profile, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'access-control-expose-headers': 'content-range, content-length, etag',
}

type Handler = (req: Request) => Response | Promise<Response>
const handlers = new Map<string, Handler>()

async function loadHandler(name: string): Promise<Handler | null> {
  if (!/^[a-z0-9-]+$/.test(name)) return null
  if (handlers.has(name)) return handlers.get(name)!
  try {
    const mod = (await import(`../supabase/functions/${name}/handler.ts`)) as { handler: Handler }
    handlers.set(name, mod.handler)
    return mod.handler
  } catch (e) {
    if (e instanceof Error && /Module not found|Cannot find module/i.test(e.message)) return null
    throw e
  }
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) if (!headers.has(k)) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

async function proxy(req: Request, prefix: string, upstream: string): Promise<Response> {
  if (req.method === 'OPTIONS') {
    // Like the hosted gateway, platform APIs accept whatever headers the client libraries send.
    const requested = req.headers.get('access-control-request-headers')
    return new Response(null, { status: 204, headers: { ...CORS, ...(requested ? { 'access-control-allow-headers': requested } : {}), 'access-control-max-age': '7200' } })
  }
  const url = new URL(req.url)
  const apikey = req.headers.get('apikey') ?? url.searchParams.get('apikey')
  // Like the hosted gateway: public objects and signed URLs need no project key.
  const openPath = /^\/storage\/v1\/(object|render\/image)\/(public|sign)\//.test(url.pathname) && (req.method === 'GET' || req.method === 'HEAD')
  if (openPath) {
    const headers = new Headers()
    for (const h of ['range', 'if-none-match', 'if-modified-since']) {
      const v = req.headers.get(h)
      if (v) headers.set(h, v)
    }
    const res = await fetch(new URL(upstream + url.pathname.slice(prefix.length) + url.search), { method: req.method, headers })
    return withCors(res)
  }
  if (!apikey || !projectKeys.has(apikey)) {
    return withCors(Response.json({ message: 'Invalid API key' }, { status: 401 }))
  }
  const target = new URL(upstream + url.pathname.slice(prefix.length) + url.search)
  const headers = new Headers(req.headers)
  headers.delete('host')
  if (!headers.has('authorization')) headers.set('authorization', `Bearer ${apikey}`)
  const res = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    redirect: 'manual',
  })
  return withCors(res)
}

// ---------------------------------------------------------------------------------------
// The web app (server): static files with the studio shells and the build's _headers.
const WEB_ROOT = env('DP_WEB_ROOT')?.replace(/\/$/, '')
let headerRules: HeaderRule[] = []
if (WEB_ROOT) {
  try {
    headerRules = parseHeadersFile(await Deno.readTextFile(`${WEB_ROOT}/_headers`))
  } catch {
    console.warn(`no ${WEB_ROOT}/_headers`)
  }
}

function isFile(path: string): boolean {
  try {
    return Deno.statSync(WEB_ROOT + path).isFile
  } catch {
    return false
  }
}

async function serveWeb(req: Request, url: URL): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  const found = resolveWebPath(url.pathname, isFile)
  const base = headersFor(headerRules, url.pathname)
  if ('notFound' in found) return new Response('not found', { status: 404, headers: { ...base, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
  const stat = await Deno.stat(WEB_ROOT + found.file)
  const etag = `W/"${stat.size.toString(36)}-${(stat.mtime?.getTime() ?? 0).toString(36)}"`
  const headers = new Headers({ ...headersFor(headerRules, found.file), ...base, 'content-type': contentType(found.file), etag })
  // Pages and the service worker must always be revalidated; hashed assets are immutable (_headers).
  if (!headers.has('cache-control')) headers.set('cache-control', found.file.endsWith('.html') || found.file.endsWith('.webmanifest') ? 'no-cache' : 'public, max-age=3600')
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  headers.set('content-length', String(stat.size))
  if (req.method === 'HEAD') return new Response(null, { headers })
  const file = await Deno.open(WEB_ROOT + found.file, { read: true })
  return new Response(file.readable, { headers })
}

// ---------------------------------------------------------------------------------------
Deno.serve({ port: PORT, hostname: HOST, onListen: () => console.log(`gateway :${PORT}${WEB_ROOT ? ` (web ${WEB_ROOT})` : ''}`) }, async (req) => {
  const url = new URL(req.url)
  for (const [prefix, upstream] of Object.entries(UPSTREAMS)) {
    if (url.pathname === prefix || url.pathname.startsWith(prefix + '/')) return proxy(req, prefix, upstream)
  }
  const fn = /^\/functions\/v1\/([^/]+)/.exec(url.pathname)
  if (fn) {
    const name = fn[1]!
    const handler = await loadHandler(name)
    if (!handler) return Response.json({ message: `function ${name} not found` }, { status: 404 })
    if (VERIFY_JWT[name] && req.method !== 'OPTIONS') {
      const token = req.headers.get('authorization')?.replace(/^Bearer /, '')
      try {
        if (!token) throw new Error('missing')
        await jwtVerify(token, secret)
      } catch {
        return withCors(Response.json({ message: 'Invalid JWT' }, { status: 401 }))
      }
    }
    try {
      return await handler(req)
    } catch (e) {
      console.error(`[${name}] unhandled`, e instanceof Error ? e.name : 'error')
      return Response.json({ error: { code: 'INTERNAL' } }, { status: 500 })
    }
  }
  if (url.pathname === '/health') return Response.json({ ok: true })
  if (WEB_ROOT) return serveWeb(req, url)
  return new Response('not found', { status: 404 })
})
