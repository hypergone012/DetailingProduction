/**
 * assistant — server-side AI helper for clients (booking) and studio staff (cabinet).
 *
 * POST /assistant/t/:slug/chat  { scope: 'client' | 'owner', messages: [{ role, text }] }
 *   client: optional x-client-key (this device's profile) for "my bookings";
 *   owner:  Authorization: Bearer <user JWT>, membership in the studio required.
 *
 * The studio comes from the URL, the identity from the request; the model only picks tools
 * from its scope. Without LLM credentials, over budget, or on an LLM failure the
 * deterministic intent router answers instead (response.mode = 'fallback' + notice).
 */
import type { Bootstrap } from '../_vendor/core/api/contracts.ts'
import { chatRequestSchema, type ChatResponse } from '../_vendor/core/ai/tools.ts'
import { clientKeyHash, slugOf } from '../_shared/client.ts'
import { config } from '../_shared/env.ts'
import { HttpError, json, parse, readJson, router, type RouteContext } from '../_shared/http.ts'
import { clientIp, limit } from '../_shared/limits.ts'
import { rpc, select } from '../_shared/postgrest.ts'
import type { Scope } from './executors.ts'
import { fallbackAnswer } from './fallback.ts'
import { localToday } from './format.ts'
import { runLlm } from './llm.ts'
import { stablePrompt, volatilePrompt } from './prompt.ts'

function bearer(req: Request): string {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token === config().anonKey) throw new HttpError('UNAUTHENTICATED', 'Требуется вход')
  return token
}

/** `sub` of a JWT. The signature is checked by PostgREST on the very next call that uses it. */
function subject(jwt: string): string {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string }
    if (payload.sub && /^[0-9a-f-]{36}$/.test(payload.sub)) return payload.sub
  } catch {
    /* fall through */
  }
  throw new HttpError('UNAUTHENTICATED', 'Требуется вход')
}

async function resolveScope(ctx: RouteContext, slug: string, kind: 'client' | 'owner', data: Bootstrap): Promise<Scope> {
  if (kind === 'client') return { kind, slug, data, profileKeyHash: await clientKeyHash(ctx.req) }
  const jwt = bearer(ctx.req)
  const rows = await select<{ role: string }>(`tenant_members?select=role&tenant_id=eq.${data.tenant.id}&user_id=eq.${subject(jwt)}`, jwt)
  const role = rows[0]?.role
  if (!role) throw new HttpError('FORBIDDEN', 'Нет доступа к кабинету этой студии')
  return { kind, slug, data, userJwt: jwt, canManage: role === 'owner' || role === 'manager' }
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']

async function chat(ctx: RouteContext) {
  const slug = slugOf(ctx)
  const ip = clientIp(ctx.req)
  await limit('ai', `${slug}:${ip}`, 20, 60)
  await limit('ai-day', `${slug}:${ip}`, 300, 86400)
  const body = parse(chatRequestSchema, await readJson(ctx.req, 64 * 1024))
  const data = await rpc<Bootstrap>('api_public_bootstrap', { p_slug: slug })
  if (data.features.ai === false) throw new HttpError('FORBIDDEN', 'Студия отключила помощника')
  const scope = await resolveScope(ctx, slug, body.scope, data)
  const tz = data.tenant.timezone
  const today = localToday(tz)
  const last = body.messages[body.messages.length - 1]!.text

  const fallback = async (notice: ChatResponse['notice']) => {
    const a = await fallbackAnswer(scope, last, today.day)
    return json(ctx.req, { mode: 'fallback', reply: a.reply, actions: a.actions, notice } satisfies ChatResponse)
  }

  const c = config()
  if (!c.llm) return fallback('not_configured')
  const budget = await rpc<{ allowed: boolean; reason?: string }>('api_ai_reserve', { p_tenant: data.tenant.id, p_scope: body.scope })
  if (!budget.allowed) return fallback(budget.reason === 'disabled' ? 'disabled' : 'budget_exhausted')

  try {
    const weekday = WEEKDAYS[new Date(`${today.day}T12:00:00Z`).getUTCDay()]!
    const r = await runLlm(c.llm, scope, { stable: stablePrompt(data, body.scope), volatile: volatilePrompt(today, weekday) }, body.messages, (n) =>
      rpc('api_ai_record_tokens', { p_tenant: data.tenant.id, p_scope: body.scope, p_tokens: n }),
    )
    return json(ctx.req, { mode: 'llm', reply: r.reply, actions: r.actions, notice: null } satisfies ChatResponse)
  } catch (e) {
    // Never leak provider errors; the booking flow keeps working without the LLM.
    console.error('[assistant llm]', e instanceof Error ? `${e.name}: ${e.message}` : e)
    return fallback('unavailable')
  }
}

export const handler = router('assistant', [{ method: 'POST', path: '/t/:slug/chat', handle: chat }])
