import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { asService, at, clientBook, createTenant, localDay, sha256, sql, type Tenant } from './helpers.ts'

afterAll(async () => {
  await sql.end()
})

interface Leased {
  job: { id: string; tenant_id: string; event: string; audience: string; attempts: number }
  booking: { id: string; internal_note?: string }
  targets: { subscription_id: string; endpoint: string }[]
}

const lease = (worker: string, limit = 50, seconds = 60) =>
  asService(async (tx) => {
    const [r] = await tx`select public.api_notifications_lease(${worker}, ${limit}, ${seconds}) as r`
    return r!.r as Leased[]
  })

const report = (job: string, worker: string, results: unknown[]) =>
  asService(async (tx) => {
    const [r] = await tx`select public.api_notifications_report(${job}, ${worker}, ${tx.json(results as never)}) as r`
    return r!.r as { accepted: boolean; status?: string }
  })

const subscription = () => ({
  endpoint: `https://push.example.test/${randomUUID()}`,
  keys: { p256dh: 'B' + 'x'.repeat(86), auth: 'a'.repeat(22) },
})

async function subscribeClient(t: Tenant, profileKey: string) {
  const sub = subscription()
  await asService((tx) => tx`select public.api_public_push_subscribe(${t.slug}, ${sha256(profileKey)}, null, null, ${tx.json(sub)}, 'test')`)
  return sub
}

async function subscribeOwner(t: Tenant) {
  const sub = subscription()
  await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: t.ownerId, role: 'authenticated' })}, true)`
    await tx`set local role authenticated`
    await tx`select public.owner_push_subscribe(${t.id}, ${tx.json(sub)}, 'test')`
  })
  return sub
}

/** Drains every due job (other test files share the queue) and keeps this tenant's. */
async function leaseFor(t: Tenant, worker: string) {
  const mine: Leased[] = []
  for (let i = 0; i < 50; i++) {
    const batch = await lease(worker, 100)
    mine.push(...batch.filter((l) => l.job.tenant_id === t.id))
    if (batch.length === 0) break
  }
  return mine
}

describe('outbox', () => {
  it('a booking enqueues created jobs for owner and client plus a reminder; demo tenants suppress all', async () => {
    const live = await createTenant()
    const demo = await createTenant({ status: 'demo' })
    const day = await localDay(live.timezone, 3)
    const b1 = await clientBook(live, { startsAt: await at(live.timezone, day, '10:00') })
    const b2 = await clientBook(demo, { startsAt: await at(demo.timezone, day, '10:00') })
    const jobs1 = await sql`select event, audience, status from public.notification_jobs where booking_id = ${b1.booking.id} order by event, audience`
    expect(jobs1.map((j) => `${j.event}/${j.audience}/${j.status}`)).toEqual([
      'booking.created/client/pending',
      'booking.created/owner/pending',
      'booking.reminder/client/pending',
    ])
    const jobs2 = await sql`select status, suppressed_reason from public.notification_jobs where booking_id = ${b2.booking.id}`
    expect(jobs2.length).toBe(3)
    expect(jobs2.every((j) => j.status === 'suppressed' && j.suppressed_reason === 'tenant_not_live')).toBe(true)
    const [reminder] = await sql`select next_attempt_at from public.notification_jobs where booking_id = ${b1.booking.id} and event = 'booking.reminder'`
    expect(reminder!.next_attempt_at.toISOString()).toBe(new Date(new Date(await at(live.timezone, day, '10:00')).getTime() - 24 * 3600_000).toISOString())
  })

  it('leases are exclusive, expire, and only the holder can complete; deliveries are never duplicated', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '12:00') })
    const s1 = await subscribeClient(t, b.profileKey)
    const s2 = await subscribeClient(t, b.profileKey)
    // the created jobs were enqueued before the subscriptions existed: that is fine, targets
    // are resolved at lease time
    const [w1, w2] = await Promise.all([leaseFor(t, 'worker-1'), leaseFor(t, 'worker-2')])
    const ids1 = new Set(w1.map((l) => l.job.id))
    const ids2 = new Set(w2.map((l) => l.job.id))
    expect([...ids1].some((id) => ids2.has(id))).toBe(false)
    const clientJob = [...w1, ...w2].find((l) => l.job.event === 'booking.created' && l.job.audience === 'client')!
    const holder = w1.includes(clientJob) ? 'worker-1' : 'worker-2'
    const other = holder === 'worker-1' ? 'worker-2' : 'worker-1'
    expect(clientJob.targets.map((x) => x.endpoint).sort()).toEqual([s1.endpoint, s2.endpoint].sort())
    expect(clientJob.booking.internal_note).toBeUndefined() // client payload, not owner payload

    // Not the holder -> rejected
    expect((await report(clientJob.job.id, other, [])).accepted).toBe(false)
    // Partial failure: s1 delivered, s2 failed -> retried later only for s2
    const t1 = clientJob.targets.find((x) => x.endpoint === s1.endpoint)!
    const t2 = clientJob.targets.find((x) => x.endpoint === s2.endpoint)!
    const r = await report(clientJob.job.id, holder, [
      { subscription_id: t1.subscription_id, status: 'sent', http_status: 201 },
      { subscription_id: t2.subscription_id, status: 'failed', http_status: 500, error: 'upstream 500' },
    ])
    expect(r).toEqual({ accepted: true, status: 'pending' })
    await sql`update public.notification_jobs set next_attempt_at = now() where id = ${clientJob.job.id}`
    const retry = (await leaseFor(t, 'worker-3')).find((l) => l.job.id === clientJob.job.id)!
    expect(retry.job.attempts).toBe(2)
    expect(retry.targets.map((x) => x.endpoint)).toEqual([s2.endpoint])
    expect((await report(retry.job.id, 'worker-3', [{ subscription_id: t2.subscription_id, status: 'sent' }])).status).toBe('sent')
    const deliveries = await sql`select subscription_id, status from public.notification_deliveries where job_id = ${clientJob.job.id}`
    expect(deliveries).toHaveLength(2)
    // A sent job is never leased again
    expect((await leaseFor(t, 'worker-4')).find((l) => l.job.id === clientJob.job.id)).toBeUndefined()
  })

  it('an expired lease is picked up by another worker; the stale worker cannot complete', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '15:00') })
    await subscribeOwner(t)
    void b
    const first = (await leaseFor(t, 'slow')).find((l) => l.job.audience === 'owner')!
    expect(first).toBeTruthy()
    await sql`update public.notification_jobs set lease_expires_at = now() - interval '1 second' where id = ${first.job.id}`
    const second = (await leaseFor(t, 'fast')).find((l) => l.job.id === first.job.id)!
    expect(second.job.attempts).toBe(2)
    expect((await report(first.job.id, 'slow', [])).accepted).toBe(false)
    expect((await report(first.job.id, 'fast', second.targets.map((x) => ({ subscription_id: x.subscription_id, status: 'sent' })))).status).toBe('sent')
  })

  it('jobs without subscribers, stale reminders and gone endpoints are finalized correctly', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '10:00') })
    // move the booking: the old reminder becomes stale
    const target = await at(t.timezone, day, '16:00')
    await asService((tx) => tx`select public.api_public_reschedule(${t.slug}, ${randomUUID()}, ${'f'.repeat(64)}, ${sha256(b.token)}, null, null, ${target})`)
    await sql`update public.notification_jobs set next_attempt_at = now() where booking_id = ${b.booking.id}`
    const sub = await subscribeClient(t, b.profileKey)
    const leased = await leaseFor(t, 'w')
    const jobs = await sql`select event, audience, status, suppressed_reason, payload from public.notification_jobs
                           where booking_id = ${b.booking.id} order by created_at, audience`
    const reminders = jobs.filter((j) => j.event === 'booking.reminder')
    expect(reminders).toHaveLength(2)
    expect(reminders.filter((j) => j.status === 'suppressed' && j.suppressed_reason === 'stale')).toHaveLength(1)
    // owner has no subscription -> suppressed as no_subscriptions
    expect(jobs.filter((j) => j.audience === 'owner').every((j) => j.status === 'suppressed' && j.suppressed_reason === 'no_subscriptions')).toBe(true)
    // gone endpoint gets disabled
    const moved = leased.find((l) => l.job.event === 'booking.moved' && l.job.audience === 'client')!
    await report(moved.job.id, 'w', [{ subscription_id: moved.targets[0]!.subscription_id, status: 'gone', http_status: 410 }])
    const [s] = await sql`select disabled_at from public.push_subscriptions where endpoint = ${sub.endpoint}`
    expect(s!.disabled_at).not.toBeNull()
  })

  it('gives up after max attempts', async () => {
    const t = await createTenant()
    const day = await localDay(t.timezone, 3)
    const b = await clientBook(t, { startsAt: await at(t.timezone, day, '18:00') })
    await subscribeClient(t, b.profileKey)
    await sql`update public.notification_jobs set max_attempts = 2 where booking_id = ${b.booking.id}`
    for (let i = 0; i < 2; i++) {
      await sql`update public.notification_jobs set next_attempt_at = now() where booking_id = ${b.booking.id} and status = 'pending'`
      const l = (await leaseFor(t, 'w')).find((x) => x.job.event === 'booking.created' && x.job.audience === 'client')!
      await report(l.job.id, 'w', l.targets.map((x) => ({ subscription_id: x.subscription_id, status: 'failed', error: 'boom' })))
    }
    const [job] = await sql`select status, attempts, last_error from public.notification_jobs
                            where booking_id = ${b.booking.id} and event = 'booking.created' and audience = 'client'`
    expect(job).toEqual({ status: 'dead', attempts: 2, last_error: 'boom' })
  })
})
