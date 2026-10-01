/**
 * LOCAL DEVELOPMENT ONLY: a stand-in for the Supabase API gateway on :54321.
 *   /auth/v1/*      -> GoTrue      :54324
 *   /rest/v1/*      -> PostgREST   :54325
 *   /storage/v1/*   -> Storage API :54326
 *   /functions/v1/<name>/* -> supabase/functions/<name>/handler.ts, executed in this Deno
 *                     process exactly as the Edge Runtime would call `Deno.serve(handler)`.
 * Like the hosted gateway it requires a valid project key (`apikey` header) for auth/rest/
 * storage and verifies the bearer JWT for functions that declare verify_jwt (config.toml).
 *
 * Run: pnpm functions:serve
 */
import { jwtVerify } from 'npm:jose@6.2.12'

const PORT = Number(Deno.env.get('DP_GATEWAY_PORT') ?? 54321)
const UPSTREAMS: Record<string, string> = {
  '/auth/v1': `http://127.0.0.1:${Deno.env.get('DP_AUTH_PORT') ?? 54324}`,
  '/rest/v1': `http://127.0.0.1:${Deno.env.get('DP_REST_PORT') ?? 54325}`,
  '/storage/v1': `http://127.0.0.1:${Deno.env.get('DP_STORAGE_PORT') ?? 54326}`,
}
// Functions that verify the caller's JWT before the handler runs (mirrors config.toml).
const VERIFY_JWT: Record<string, boolean> = {
  'public-api': false,
  'owner-api': true,
  assistant: false,
  'notify-dispatcher': false,
}

const keys = JSON.parse(await Deno.readTextFile(new URL('../../.local/keys.json', import.meta.url))) as {
  url: string
  anonKey: string
  serviceRoleKey: string
  jwtSecret: string
}
const defaults: Record<string, string> = {
  SUPABASE_URL: keys.url,
  SUPABASE_ANON_KEY: keys.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: keys.serviceRoleKey,
  SUPABASE_JWT_ISSUER: `${keys.url}/auth/v1`,
}
for (const [k, v] of Object.entries(defaults)) if (!Deno.env.get(k)) Deno.env.set(k, v)
const secret = new TextEncoder().encode(Deno.env.get('DP_JWT_SECRET') ?? keys.jwtSecret)
const projectKeys = new Set([keys.anonKey, keys.serviceRoleKey])

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-upsert, range, prefer, accept-profile, content-profile, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'access-control-expose-headers': 'content-range, content-length, etag',
}

type Handler = (req: Request) => Response | Promise<Response>
const handlers = new Map<string, Handler>()

async function loadHandler(name: string): Promise<Handler | null> {
  if (!/^[a-z0-9-]+$/.test(name)) return null
  if (handlers.has(name)) return handlers.get(name)!
  try {
    const mod = (await import(`../../supabase/functions/${name}/handler.ts`)) as { handler: Handler }
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
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const apikey = req.headers.get('apikey') ?? new URL(req.url).searchParams.get('apikey')
  if (!apikey || !projectKeys.has(apikey)) {
    return withCors(Response.json({ message: 'Invalid API key' }, { status: 401 }))
  }
  const url = new URL(req.url)
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

Deno.serve({ port: PORT, hostname: '127.0.0.1' }, async (req) => {
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
  return new Response('not found', { status: 404 })
})
console.log(`gateway :${PORT}`)
