import { afterEach, describe, expect, it, vi } from 'vitest'
import { isStaleBuildError, reloadForNewBuild } from './chunk-recovery'

describe('stale build recovery', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('recognises a failed lazy import in every browser', () => {
    expect(isStaleBuildError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true)
    expect(isStaleBuildError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleBuildError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isStaleBuildError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isStaleBuildError('x')).toBe(false)
  })

  it('reloads once, not in a loop', () => {
    const store = new Map<string, string>()
    const reload = vi.fn()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    vi.stubGlobal('window', { location: { reload } })
    expect(reloadForNewBuild()).toBe(true)
    expect(reloadForNewBuild()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never reloads offline (the error screen is better than no page)', () => {
    const reload = vi.fn()
    vi.stubGlobal('navigator', { onLine: false })
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} })
    vi.stubGlobal('window', { location: { reload } })
    expect(reloadForNewBuild()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
