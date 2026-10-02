import { describe, expect, it } from 'vitest'
import { isTransientDbError, withRetry } from './retry.ts'

describe('database retries', () => {
  it('retries what passes on its own, not real mistakes', () => {
    expect(isTransientDbError({ code: '28P01', message: 'password authentication failed for user "postgres"' })).toBe(true)
    expect(isTransientDbError({ code: 'ECONNRESET' })).toBe(true)
    expect(isTransientDbError({ code: 'XX000', message: 'Tenant or user not found' })).toBe(true)
    expect(isTransientDbError({ code: '42601', message: 'syntax error at or near' })).toBe(false)
    expect(isTransientDbError({ code: 'ENOTFOUND' })).toBe(false)
  })

  it('stops after the last attempt and passes other errors through at once', async () => {
    let n = 0
    await expect(withRetry('t', async () => (n++, Promise.reject(Object.assign(new Error('password authentication failed'), { code: '28P01' }))), 3, 1)).rejects.toThrow()
    expect(n).toBe(3)
    n = 0
    await expect(withRetry('t', async () => (n++, Promise.reject(new Error('syntax error'))), 3, 1)).rejects.toThrow('syntax error')
    expect(n).toBe(1)
    n = 0
    expect(await withRetry('t', async () => (++n < 2 ? Promise.reject(Object.assign(new Error('x'), { code: 'ECONNRESET' })) : 'ok'), 3, 1)).toBe('ok')
  })
})
