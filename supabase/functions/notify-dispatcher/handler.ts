/**
 * notify-dispatcher — drains the notification outbox. Triggered every minute by Supabase
 * Cron (pg_net POST with the shared secret). Each run leases due jobs, renders the text in
 * the studio's timezone, sends Web Push to every target subscription and reports per
 * subscription, so a retry never re-sends to a device that already got the message.
 */
import { safeEqual } from '../_vendor/core/crypto.ts'
import { renderMessage, type NotificationEvent } from '../_vendor/core/push/messages.ts'
import { sendPush } from '../_vendor/core/push/webpush.ts'
import { config } from '../_shared/env.ts'
import { HttpError, json, router, type RouteContext } from '../_shared/http.ts'
import { rpc } from '../_shared/postgrest.ts'

interface LeasedJob {
  job: { id: string; tenant_id: string; event: NotificationEvent; audience: 'client' | 'owner'; attempts: number }
  booking: {
    id: string
    code: string
    status: string
    starts_at: string
    service: { name: string }
    vehicle?: { make: string; model: string; plate?: string | null } | null
    customer?: { name: string } | null
  }
  tenant: { name: string; slug: string; timezone: string; locale: string }
  targets: { subscription_id: string; endpoint: string; p256dh: string; auth: string }[]
}

const TIME_BUDGET_MS = 20_000

async function dispatch(ctx: RouteContext) {
  const c = config()
  const secret = ctx.req.headers.get('x-dispatcher-secret') ?? ''
  if (!c.dispatcherSecret || !safeEqual(secret, c.dispatcherSecret)) throw new HttpError('UNAUTHENTICATED', 'invalid dispatcher secret')
  if (!c.vapid) {
    // Without VAPID keys nothing can be delivered; jobs stay pending instead of burning retries.
    return json(ctx.req, { skipped: 'push_not_configured' })
  }
  const worker = `dispatcher-${crypto.randomUUID()}`
  const started = Date.now()
  const summary = { leased: 0, sent: 0, gone: 0, failed: 0, jobs_sent: 0, jobs_retry: 0, jobs_dead: 0 }
  while (Date.now() - started < TIME_BUDGET_MS) {
    const batch = await rpc<LeasedJob[]>('api_notifications_lease', { p_worker: worker, p_limit: 25, p_lease_seconds: 60 })
    if (batch.length === 0) break
    summary.leased += batch.length
    for (const item of batch) {
      const message = renderMessage({ event: item.job.event, audience: item.job.audience, tenant: item.tenant, booking: item.booking })
      const results = await Promise.all(
        item.targets.map(async (t) => {
          const r = await sendPush({ endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth }, message, c.vapid!, {
            ttl: item.job.event === 'booking.reminder' ? 6 * 3600 : 24 * 3600,
            urgency: item.job.event === 'booking.cancelled' || item.job.event === 'booking.moved' ? 'high' : 'normal',
            topic: `b${item.booking.id.replace(/-/g, '').slice(0, 24)}${item.job.audience[0]}`,
          })
          summary[r.status]++
          return { subscription_id: t.subscription_id, ...r }
        }),
      )
      const report = await rpc<{ accepted: boolean; status?: string }>('api_notifications_report', {
        p_job: item.job.id,
        p_worker: worker,
        p_results: results,
      })
      if (report.status === 'sent') summary.jobs_sent++
      else if (report.status === 'dead') summary.jobs_dead++
      else if (report.status === 'pending') summary.jobs_retry++
    }
  }
  return json(ctx.req, summary)
}

export const handler = router('notify-dispatcher', [{ method: 'POST', path: '/', handle: dispatch }])
