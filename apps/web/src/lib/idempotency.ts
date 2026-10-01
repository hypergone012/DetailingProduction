import { session } from '@/lib/storage'

/**
 * One Idempotency-Key per user action. Kept in sessionStorage until the action succeeds,
 * so a retry after a network failure (or a double tap) reuses the same key and the server
 * returns the same result instead of doing the work twice.
 */
export function actionKey(scope: string): string {
  const existing = session.get(`idem:${scope}`)
  if (existing) return existing
  const key = crypto.randomUUID()
  session.set(`idem:${scope}`, key)
  return key
}

export function completeAction(scope: string): void {
  session.remove(`idem:${scope}`)
}
