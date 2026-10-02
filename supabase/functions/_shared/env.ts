/** Edge Function configuration. Everything here is server-side only. */

export interface Config {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  publicStorageUrl: string
  appUrl: string
  allowedOrigins: string[]
  accessTokenSecret: string
  trustedProxyHops: number
  vapid: { publicKey: string; privateKey: string; subject: string } | null
  dispatcherSecret: string | null
  llm: { baseUrl: string; apiKey: string; model: string } | null
}

let cached: Config | null = null

function get(name: string): string | undefined {
  const v = Deno.env.get(name)
  return v && v.trim() !== '' ? v.trim() : undefined
}

function required(name: string): string {
  const v = get(name)
  if (!v) throw new Error(`missing required env ${name}`)
  return v
}

export function config(): Config {
  if (cached) return cached
  const secret = required('ACCESS_TOKEN_SECRET')
  if (secret.length < 32) throw new Error('ACCESS_TOKEN_SECRET must be at least 32 characters')
  const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '')
  const vapidPublic = get('VAPID_PUBLIC_KEY')
  const vapidPrivate = get('VAPID_PRIVATE_KEY')
  const llmKey = get('LLM_API_KEY')
  cached = {
    supabaseUrl,
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    publicStorageUrl: (get('PUBLIC_STORAGE_URL') ?? supabaseUrl).replace(/\/$/, ''),
    appUrl: required('APP_URL').replace(/\/$/, ''),
    allowedOrigins: (get('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter((o) => o !== '' && o !== '*' && (o.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o))),
    accessTokenSecret: secret,
    trustedProxyHops: Number(get('TRUSTED_PROXY_HOPS') ?? '1'),
    vapid: vapidPublic && vapidPrivate ? { publicKey: vapidPublic, privateKey: vapidPrivate, subject: get('VAPID_SUBJECT') ?? 'mailto:ops@example.com' } : null,
    dispatcherSecret: get('DISPATCHER_SECRET') ?? null,
    llm: llmKey ? { baseUrl: (get('LLM_BASE_URL') ?? 'https://api.anthropic.com/v1').replace(/\/$/, ''), apiKey: llmKey, model: get('LLM_MODEL') ?? 'claude-opus-5-5' } : null,
  }
  return cached
}

/** Tests only: drop the cached config after changing env. */
export function resetConfig(): void {
  cached = null
}
