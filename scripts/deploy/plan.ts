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

export interface RawInputs {
  accessToken?: string
  projectRef?: string
  databaseUrl?: string
  cfApiToken?: string
  cfAccountId?: string
  demoPassword?: string
  llmApiKey?: string
  pagesProject?: string
}

export interface Inputs {
  accessToken: string
  projectRef: string
  databaseUrl: string
  cfApiToken: string
  cfAccountId: string
  demoPassword: string
  llmApiKey: string
  pagesProject: string
}

const clean = (v: string | undefined) => (v ?? '').trim().replace(/^["'«](.*)["'»]$/s, '$1').trim()

/**
 * Repository secrets as people paste them -> exact values, or every problem at once in plain
 * Russian. Tolerates the usual copy-paste slips (the whole dashboard address instead of the id,
 * spaces, line breaks, quotes); never echoes a secret value, only its shape.
 */
export function normalizeInputs(raw: RawInputs): { inputs: Inputs; problems: string[]; warnings: string[] } {
  const problems: string[] = []
  const warnings: string[] = []
  const v = Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, clean(x)])) as Record<keyof RawInputs, string>

  // Supabase project ref: 20 lowercase letters, or a dashboard / API address that contains it.
  const ref = /^[a-z]{20}$/.exec(v.projectRef)?.[0] ?? /project\/([a-z]{20})(?![a-z])/.exec(v.projectRef)?.[1] ?? /(?<![a-z])([a-z]{20})\.supabase\.co/.exec(v.projectRef)?.[1] ?? ''
  if (!v.projectRef) problems.push('Не задан секрет SUPABASE_PROJECT_REF.')
  else if (!ref) problems.push(`SUPABASE_PROJECT_REF: нужен Project ref — 20 строчных латинских букв из адреса supabase.com/dashboard/project/<ref>. Сейчас длина значения: ${v.projectRef.length}.`)

  // Access token of the Supabase account (not a project API key, not the database password).
  if (!v.accessToken) problems.push('Не задан секрет SUPABASE_ACCESS_TOKEN.')
  else if (!/^sbp_[A-Za-z0-9_]+$/.test(v.accessToken)) problems.push('SUPABASE_ACCESS_TOKEN: токен должен начинаться с «sbp_» (Supabase → аватар → Account preferences → Access Tokens). Ключи anon / service_role и пароль базы сюда не подходят.')

  // Session pooler connection string with the password filled in.
  let databaseUrl = ''
  if (!v.databaseUrl) problems.push('Не задан секрет SUPABASE_DB_URL.')
  else if (v.databaseUrl.includes('[YOUR-PASSWORD]')) problems.push('SUPABASE_DB_URL: в строке остался шаблон [YOUR-PASSWORD] — замените его (вместе со скобками) на пароль базы.')
  else {
    let url: URL | null = null
    try {
      url = new URL(v.databaseUrl.replace(/\s+/g, ''))
    } catch {
      problems.push('SUPABASE_DB_URL: строку не удалось разобрать. Скопируйте её заново (Connect → Session pooler); если в пароле базы есть символы @ : / ? # %, смените пароль на буквы и цифры (Project Settings → Database → Reset database password).')
    }
    if (url) {
      const host = url.hostname
      if (!/^postgres(ql)?:$/.test(url.protocol)) problems.push('SUPABASE_DB_URL: строка должна начинаться с postgresql:// (Connect → Connection String → Session pooler).')
      else if (/^db\..+\.supabase\.co$/.test(host)) problems.push('SUPABASE_DB_URL: это строка «Direct connection». Нужна строка из блока «Session pooler» (Connect → Session pooler), в ней адрес …pooler.supabase.com:5432.')
      else if (url.port === '6543') problems.push('SUPABASE_DB_URL: это «Transaction pooler» (порт 6543). Нужен «Session pooler» — порт 5432.')
      else if (!url.password) problems.push('SUPABASE_DB_URL: в строке нет пароля — после «postgres.<ref>:» должен идти пароль базы, затем «@».')
      else if (host.endsWith('.pooler.supabase.com') && ref && decodeURIComponent(url.username) !== `postgres.${ref}`)
        problems.push('SUPABASE_DB_URL: строка подключения от другого проекта, чем SUPABASE_PROJECT_REF (в начале строки должно быть postgres.<ваш ref>).')
      else {
        // An unfamiliar host is not rejected (Supabase may change its pooler addresses): the
        // connection probe that follows tells whether it works. Host and port are not secret.
        if (!host.endsWith('.pooler.supabase.com')) warnings.push(`SUPABASE_DB_URL: необычный адрес базы «${host}:${url.port || '5432'}» — ожидался …pooler.supabase.com:5432 (Connect → Session pooler). Пробую подключиться.`)
        databaseUrl = v.databaseUrl.replace(/\s+/g, '')
      }
    }
  }

  // Cloudflare account id: 32 hex characters, also found inside a pasted dashboard address.
  const accountId = /[0-9a-f]{32}/i.exec(v.cfAccountId)?.[0]?.toLowerCase() ?? ''
  if (!v.cfAccountId) problems.push('Не задан секрет CLOUDFLARE_ACCOUNT_ID.')
  else if (!accountId) {
    const looks = v.cfAccountId.includes('@') ? ' Похоже, туда вставлена почта.' : v.cfAccountId.length >= 38 && !/\s/.test(v.cfAccountId) ? ' Похоже, туда вставлен API-токен.' : ''
    problems.push(`CLOUDFLARE_ACCOUNT_ID: нужен Account ID — 32 символа (цифры и буквы a–f). Его видно в адресе страницы после входа: dash.cloudflare.com/<ID>/home. Сейчас длина значения: ${v.cfAccountId.length}.${looks}`)
  }

  // Cloudflare API token.
  if (!v.cfApiToken) problems.push('Не задан секрет CLOUDFLARE_API_TOKEN.')
  else if (/\s/.test(v.cfApiToken)) problems.push('CLOUDFLARE_API_TOKEN: внутри токена пробел или перенос строки — скопируйте токен заново, одной строкой.')
  else if (/^[0-9a-f]{32}$/i.test(v.cfApiToken)) problems.push('CLOUDFLARE_API_TOKEN: похоже, туда вставлен Account ID. Нужен токен из My Profile → API Tokens → Create Token (право Cloudflare Pages: Edit).')
  else if (v.cfApiToken.length < 30) problems.push(`CLOUDFLARE_API_TOKEN: слишком короткий (длина ${v.cfApiToken.length}) — похоже, скопирован не целиком.`)

  if (!v.demoPassword) problems.push('Не задан секрет DEMO_OWNER_PASSWORD.')
  else if (v.demoPassword.length < 8) problems.push('DEMO_OWNER_PASSWORD: пароль не короче 8 символов.')
  else if (/[\r\n]/.test(v.demoPassword)) problems.push('DEMO_OWNER_PASSWORD: пароль должен быть одной строкой.')

  if (v.llmApiKey && /\s/.test(v.llmApiKey)) problems.push('LLM_API_KEY: внутри ключа пробел или перенос строки — скопируйте ключ заново.')

  if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(v.pagesProject)) problems.push(`Имя проекта Cloudflare Pages: только строчная латиница, цифры и дефис (сейчас: «${v.pagesProject}»).`)

  return {
    inputs: { accessToken: v.accessToken, projectRef: ref, databaseUrl, cfApiToken: v.cfApiToken, cfAccountId: accountId, demoPassword: v.demoPassword, llmApiKey: v.llmApiKey, pagesProject: v.pagesProject },
    problems,
    warnings,
  }
}

/**
 * A failed database connection in plain Russian: what is wrong and where to fix it. The
 * password is never part of the text; host and port are (they are not secret).
 */
export function explainDbError(e: unknown, databaseUrl: string): string {
  const err = (e ?? {}) as { code?: string; message?: string }
  let host = ''
  let port = '5432'
  let password = ''
  try {
    const u = new URL(databaseUrl)
    host = u.hostname
    port = u.port || '5432'
    password = decodeURIComponent(u.password)
  } catch {
    // keep defaults
  }
  const raw = String(err.message ?? e)
  const message = password ? raw.split(password).join('***') : raw
  const where = host ? ` (${host}:${port})` : ''
  if (err.code === '28P01' || /password authentication failed/i.test(raw))
    return `SUPABASE_DB_URL: база отклонила пароль${where}. Проверьте пароль в строке. Если не помните — Supabase → Project Settings → Database → Reset database password (только буквы и цифры), вставьте новый пароль в строку и обновите секрет.`
  if (/tenant or user not found/i.test(raw))
    return `SUPABASE_DB_URL: сервер не узнал пользователя${where}. В строке Session pooler имя пользователя — postgres.<ваш ref>. Скопируйте строку заново: Connect → Session pooler.`
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return `SUPABASE_DB_URL: сервер базы «${host}» не найден. Скопируйте строку заново: Connect → Session pooler.`
  if (['ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'ECONNREFUSED', 'CONNECT_TIMEOUT'].includes(err.code ?? ''))
    return `SUPABASE_DB_URL: не удаётся подключиться к ${host}:${port}. Скорее всего это строка «Direct connection» (она работает только по IPv6). Нужна строка из блока «Session pooler» (Connect → Session pooler), порт 5432.`
  return `SUPABASE_DB_URL: не удалось подключиться к базе${where}: ${message}`
}
