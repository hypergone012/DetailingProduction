import { isKnownCode } from '../_vendor/core/api/errors.ts'
import { config } from './env.ts'
import { HttpError } from './http.ts'

interface PostgrestError {
  code?: string
  message?: string
  details?: string | null
}

/**
 * Calls a Postgres function through PostgREST.
 *   - without `userJwt`: as the service role (only `api_*` functions are executable by it);
 *   - with `userJwt`: as that user, so RLS and the owner_* role checks apply.
 * Business errors raised by `private.fail` come back as P0001 with a stable code.
 */
export async function rpc<T>(fn: string, args: Record<string, unknown>, opts: { userJwt?: string } = {}): Promise<T> {
  const c = config()
  const res = await fetch(`${c.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: opts.userJwt ? c.anonKey : c.serviceRoleKey,
      authorization: `Bearer ${opts.userJwt ?? c.serviceRoleKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(args),
  })
  if (res.ok) return (await res.json()) as T
  let err: PostgrestError = {}
  try {
    err = (await res.json()) as PostgrestError
  } catch {
    /* non-JSON error body */
  }
  if (err.code === 'P0001' && err.message && isKnownCode(err.message)) {
    throw new HttpError(err.message, err.details ?? undefined)
  }
  if (res.status === 401 || err.code === 'PGRST301' || err.code === 'PGRST302') throw new HttpError('UNAUTHENTICATED', 'Требуется вход')
  if (err.code === '42501') throw new HttpError('FORBIDDEN', 'Недостаточно прав')
  console.error(`[rpc ${fn}] status=${res.status} code=${err.code ?? 'none'}`)
  throw new HttpError('INTERNAL')
}
