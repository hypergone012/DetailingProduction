/**
 * Pure helpers of the deploy workflow (.github/workflows/deploy.yml), kept apart from the
 * scripts that talk to Supabase so they can be unit-tested.
 */

/** Server secrets the deploy generates once and keeps in Supabase Vault (name in Vault -> env). */
export const VAULT_SECRETS = {
  dp_access_token_secret: 'ACCESS_TOKEN_SECRET',
  dispatcher_secret: 'DISPATCHER_SECRET', // the name the Cron job reads
  dp_vapid_public_key: 'VAPID_PUBLIC_KEY',
  dp_vapid_private_key: 'VAPID_PRIVATE_KEY',
} as const

export type VaultName = keyof typeof VAULT_SECRETS

export interface Generators {
  random: (bytes: number) => string
  vapid: () => Promise<{ publicKey: string; privateKey: string }>
}

/**
 * Keeps every secret that already exists (re-deploys must not rotate them: booking links are
 * derived from ACCESS_TOKEN_SECRET and push subscriptions are bound to the VAPID key) and
 * generates only the missing ones. The VAPID pair is always generated together.
 */
export async function planSecrets(existing: Partial<Record<VaultName, string>>, gen: Generators): Promise<{ values: Record<VaultName, string>; created: VaultName[] }> {
  const values = { ...existing } as Record<VaultName, string>
  const created: VaultName[] = []
  if (!existing.dp_access_token_secret) {
    values.dp_access_token_secret = gen.random(48)
    created.push('dp_access_token_secret')
  }
  if (!existing.dispatcher_secret) {
    values.dispatcher_secret = gen.random(32)
    created.push('dispatcher_secret')
  }
  if (!existing.dp_vapid_public_key || !existing.dp_vapid_private_key) {
    const pair = await gen.vapid()
    values.dp_vapid_public_key = pair.publicKey
    values.dp_vapid_private_key = pair.privateKey
    created.push('dp_vapid_public_key', 'dp_vapid_private_key')
  }
  return { values, created }
}

export interface FunctionEnvInput {
  vault: Record<VaultName, string>
  appUrl: string
  llm?: { apiKey?: string; model?: string; baseUrl?: string }
}

/** Edge Function secrets (`supabase secrets set --env-file`). SUPABASE_* are provided by the platform. */
export function functionEnv({ vault, appUrl, llm }: FunctionEnvInput): Record<string, string> {
  const origin = new URL(appUrl).origin
  const env: Record<string, string> = {
    APP_URL: origin,
    ALLOWED_ORIGINS: origin,
    TRUSTED_PROXY_HOPS: '1',
    VAPID_SUBJECT: origin,
  }
  for (const [name, key] of Object.entries(VAULT_SECRETS) as [VaultName, string][]) env[key] = vault[name]
  if (llm?.apiKey) {
    env.LLM_API_KEY = llm.apiKey
    if (llm.model) env.LLM_MODEL = llm.model
    if (llm.baseUrl) env.LLM_BASE_URL = llm.baseUrl
  }
  return env
}

export function toDotenv(env: Record<string, string>): string {
  return (
    Object.entries(env)
      .map(([k, v]) => {
        if (/[\r\n]/.test(v)) throw new Error(`${k}: multi-line values are not supported`)
        return `${k}=${v}`
      })
      .join('\n') + '\n'
  )
}

interface ApiKeyRow {
  name?: string
  api_key?: string
  type?: string | null
}

/**
 * The anon and service_role JWT keys from `supabase projects api-keys -o json`. The app sends
 * the anon key from the browser and the service role key as a Bearer token from the server,
 * so both must be the JWT ("legacy") keys.
 */
export function pickJwtKeys(json: unknown): { anonKey: string; serviceRoleKey: string } {
  const rows = (Array.isArray(json) ? json : []) as ApiKeyRow[]
  const find = (name: string) => rows.find((r) => r.name === name && typeof r.api_key === 'string' && r.api_key.split('.').length === 3)?.api_key
  const anonKey = find('anon')
  const serviceRoleKey = find('service_role')
  if (!anonKey || !serviceRoleKey) {
    throw new Error(
      'В проекте Supabase не найдены JWT-ключи anon и service_role. Откройте Project Settings → API Keys → вкладку «Legacy API keys» и включите их, затем запустите выкладку снова.',
    )
  }
  return { anonKey, serviceRoleKey }
}

/**
 * The project's *.pages.dev address from `wrangler pages project list --json`. Cloudflare adds
 * a suffix when the name is taken elsewhere (detailing-studio-1x2.pages.dev), so it is read,
 * not assumed.
 */
export function pickPagesDomain(json: unknown, project: string): string {
  const rows = (Array.isArray(json) ? json : []) as Record<string, string>[]
  const row = rows.find((r) => r['Project Name'] === project)
  const domain = row?.['Project Domains']
    ?.split(',')
    .map((d) => d.trim())
    .find((d) => d.endsWith('.pages.dev'))
  if (!domain) throw new Error(`Проект Cloudflare Pages «${project}» не найден или у него нет адреса *.pages.dev`)
  return domain
}
