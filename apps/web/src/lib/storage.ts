/**
 * localStorage that never throws (private mode, blocked storage, quota) and namespaces
 * every key, so "forget this device" can wipe exactly what the app stored.
 */
const PREFIX = 'dp:'

export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(PREFIX + key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(PREFIX + key, value)
    } catch {
      /* storage unavailable: the app keeps working without persistence */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(PREFIX + key)
    } catch {
      /* ignore */
    }
  },
  getJson<T>(key: string, fallback: T): T {
    const raw = storage.get(key)
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  },
  setJson(key: string, value: unknown): void {
    storage.set(key, JSON.stringify(value))
  },
  /** Removes every key under a prefix (e.g. all data of one studio). */
  clearPrefix(prefix: string): void {
    try {
      const keys: string[] = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)
        if (k?.startsWith(PREFIX + prefix)) keys.push(k)
      }
      for (const k of keys) window.localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  },
}

export const session = {
  get(key: string): string | null {
    try {
      return window.sessionStorage.getItem(PREFIX + key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      window.sessionStorage.setItem(PREFIX + key, value)
    } catch {
      /* ignore */
    }
  },
  remove(key: string): void {
    try {
      window.sessionStorage.removeItem(PREFIX + key)
    } catch {
      /* ignore */
    }
  },
}
