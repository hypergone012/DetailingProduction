import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { asService, createTenant, sql } from './helpers.ts'

afterAll(async () => {
  await sql.end()
})

const reserve = (tenantId: string, scope: 'client' | 'owner') =>
  asService(async (tx) => {
    const [r] = await tx`select public.api_ai_reserve(${tenantId}, ${scope}) as r`
    return r!.r as { allowed: boolean; reason?: string }
  })

const recordTokens = (tenantId: string, scope: 'client' | 'owner', n: number) =>
  asService((tx) => tx`select public.api_ai_record_tokens(${tenantId}, ${scope}, ${n})`)

describe('AI budget (per studio, per studio-local day)', () => {
  it('is atomic: a burst of parallel requests never exceeds the daily request limit', async () => {
    const t = await createTenant()
    await sql`update public.tenant_settings set ai_daily_request_limit = 5 where tenant_id = ${t.id}`
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => reserve(t.id, i % 2 ? 'client' : 'owner')))
    expect(results.filter((r) => r.allowed)).toHaveLength(5)
    expect(results.filter((r) => !r.allowed).every((r) => r.reason === 'budget_exhausted')).toBe(true)
    const [{ n }] = (await sql`select sum(requests)::int as n from private.ai_usage where tenant_id = ${t.id}`) as unknown as [{ n: number }]
    expect(n).toBe(5)
  })

  it('stops when the token budget is spent, and studios do not share budgets', async () => {
    const t = await createTenant()
    const other = await createTenant()
    await sql`update public.tenant_settings set ai_daily_token_budget = 1000 where tenant_id = ${t.id}`
    expect((await reserve(t.id, 'client')).allowed).toBe(true)
    await recordTokens(t.id, 'client', 1200)
    expect(await reserve(t.id, 'client')).toEqual({ allowed: false, reason: 'budget_exhausted' })
    expect(await reserve(t.id, 'owner')).toEqual({ allowed: false, reason: 'budget_exhausted' })
    expect((await reserve(other.id, 'client')).allowed).toBe(true)
    await recordTokens(t.id, 'client', -500) // negative usage is ignored, never refunds budget
    expect((await reserve(t.id, 'client')).allowed).toBe(false)
  })

  it('a studio that switched the assistant off gets "disabled"', async () => {
    const t = await createTenant()
    await sql`update public.tenant_settings set features = features || '{"ai": false}' where tenant_id = ${t.id}`
    expect(await reserve(t.id, 'client')).toEqual({ allowed: false, reason: 'disabled' })
  })

  it('only the service role can reserve or record (not clients, not owners)', async () => {
    const t = await createTenant()
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role authenticated`
        await tx`select public.api_ai_reserve(${t.id}, 'owner')`
      }),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('rate limits', () => {
  it('count hits atomically per bucket and key within a window', async () => {
    const key = randomUUID()
    const hits = await Promise.all(
      Array.from({ length: 30 }, () =>
        asService(async (tx) => {
          const [r] = await tx`select public.api_rate_limit_hit('test', ${key}, 10, 60) as r`
          return r!.r as { allowed: boolean; hits: number }
        }),
      ),
    )
    expect(hits.filter((h) => h.allowed)).toHaveLength(10)
    expect(new Set(hits.map((h) => h.hits)).size).toBe(30) // every hit got its own count
    const other = await asService(async (tx) => {
      const [r] = await tx`select public.api_rate_limit_hit('test', ${randomUUID()}, 10, 60) as r`
      return r!.r as { allowed: boolean; hits: number }
    })
    expect(other).toMatchObject({ allowed: true, hits: 1 })
  })
})
