/**
 * owner-api — owner actions that need a server secret. The caller's Supabase JWT is
 * forwarded to PostgREST, so membership and role are checked by the owner_* SQL functions
 * under RLS; this function never uses the service role.
 */
import { randomToken, sha256Bytea } from '../_vendor/core/crypto.ts'
import { config } from '../_shared/env.ts'
import { HttpError, json, router, type RouteContext } from '../_shared/http.ts'
import { rpc } from '../_shared/postgrest.ts'

function userJwt(req: Request): string {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token === config().anonKey) {
    throw new HttpError('UNAUTHENTICATED', 'Требуется вход')
  }
  return token
}

/** A link the studio can send to a client (e.g. for a booking created by phone). */
async function shareLink(ctx: RouteContext) {
  const jwt = userJwt(ctx.req)
  const id = ctx.params.id ?? ''
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError('BOOKING_NOT_FOUND', 'Запись не найдена')
  const token = randomToken()
  const r = await rpc<{ ok: boolean; slug: string }>('owner_issue_share_token', { p_booking: id, p_token_hash: await sha256Bytea(token) }, { userJwt: jwt })
  return json(ctx.req, { url: `${config().appUrl}/s/${r.slug}/b/${id}#t=${token}` }, 201)
}

export const handler = router('owner-api', [{ method: 'POST', path: '/bookings/:id/share-link', handle: shareLink }])
