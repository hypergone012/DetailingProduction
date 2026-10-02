/**
 * Supabase's pooler can refuse the first connections for a few minutes after the database
 * password was reset, and connections can drop; such failures pass on their own. The callers
 * are idempotent (migrations keep a ledger, secrets are read before they are created).
 */
export function isTransientDbError(e: unknown): boolean {
  const err = (e ?? {}) as { code?: string; message?: string }
  if (['28P01', '57P01', '57P03', '08006', '08001', 'ECONNRESET', 'ETIMEDOUT', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'EPIPE'].includes(err.code ?? '')) return true
  return /password authentication failed|tenant or user not found|connection terminated|server closed the connection|too many connections|no pg_hba/i.test(String(err.message ?? ''))
}

export async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4, delayMs = 5000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i >= attempts || !isTransientDbError(e)) throw e
      console.log(`${label}: ${(e as Error).message} — повтор ${i}/${attempts - 1} через ${delayMs / 1000} с`)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
}
