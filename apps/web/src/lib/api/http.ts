import { ERROR_MESSAGES } from '@dp/core/api/errors'
import { env } from '@/lib/env'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export interface RequestOptions {
  method?: string
  json?: unknown
  body?: BodyInit
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  /** `no-cache`: revalidate with the server instead of reusing a cached response. */
  cache?: RequestCache
  /**
   * Public GET without the project key header: a "simple" cross-origin request, so the
   * browser skips the CORS preflight round trip. Retried once with the key if refused.
   */
  bare?: boolean
}

/** Set once the platform refused a call without the key: then every call carries it. */
let keyRequired = false

/** Calls an Edge Function. Errors always surface as ApiError with a stable code and a human message. */
export async function callFunction<T>(path: string, o: RequestOptions = {}): Promise<T> {
  const bare = o.bare && !keyRequired
  const headers: Record<string, string> = { ...(bare ? {} : { apikey: env.anonKey }), ...o.headers }
  let body = o.body
  if (o.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(o.json)
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), o.timeoutMs ?? 20_000)
  o.signal?.addEventListener('abort', () => controller.abort())
  let res: Response
  try {
    res = await fetch(`${env.functionsUrl}${path}`, { method: o.method ?? 'GET', headers, body, signal: controller.signal, ...(o.cache ? { cache: o.cache } : {}) })
  } catch {
    throw new ApiError('NETWORK', navigator.onLine ? ERROR_MESSAGES.INTERNAL! : ERROR_MESSAGES.NETWORK!, 0)
  } finally {
    window.clearTimeout(timer)
  }
  if (res.status === 401 && bare) {
    keyRequired = true
    return callFunction<T>(path, { ...o, bare: false })
  }
  if (res.ok) {
    const type = res.headers.get('content-type') ?? ''
    return (type.includes('json') ? await res.json() : await res.text()) as T
  }
  let code = 'INTERNAL'
  let message = ERROR_MESSAGES.INTERNAL!
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string } }
    code = data.error?.code ?? code
    message = data.error?.message ?? message
  } catch {
    /* not JSON */
  }
  throw new ApiError(code, message, res.status)
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return ERROR_MESSAGES.INTERNAL!
}
