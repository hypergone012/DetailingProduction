/**
 * Steps of the one-click deploy (.github/workflows/deploy.yml) that talk to Supabase.
 *
 *   tsx scripts/deploy/cli.ts check       repository secrets (RAW_*) -> exact values in $GITHUB_ENV, or every problem at once
 *   tsx scripts/deploy/cli.ts pages       create the Cloudflare Pages project if needed; APP_URL -> $GITHUB_ENV
 *   tsx scripts/deploy/cli.ts keys        anon / service_role keys -> $GITHUB_ENV (masked)
 *   tsx scripts/deploy/cli.ts extensions  enable pg_cron + pg_net (before migrations)
 *   tsx scripts/deploy/cli.ts finalize --out=<path>
 *        server secrets: generated once, kept in Vault, re-applied on every deploy;
 *        Vault entries for the Cron job; Cron schedules; Edge Function env file
 *   tsx scripts/deploy/cli.ts auth        Auth: site URL, redirect URLs, sign-up off (Management API)
 *   tsx scripts/deploy/cli.ts summary     links for $GITHUB_STEP_SUMMARY
 *
 * Env: SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN, DATABASE_URL, APP_URL, optional LLM_*.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import postgres from 'postgres'
import { generateVapidKeys } from '@dp/core/push/webpush'
import { sslFor } from '../db/migrate.ts'
import { explainDbError, functionEnv, normalizeInputs, pickJwtKeys, pickPagesDomain, planSecrets, toDotenv, VAULT_SECRETS, type VaultName } from './plan.ts'

const [command, ...args] = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

function need(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`не задана переменная ${name}`)
  return v
}

/** Hides a value in GitHub Actions logs from here on. */
function mask(value: string) {
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${value}`)
}

function exportEnv(name: string, value: string) {
  const file = process.env.GITHUB_ENV
  if (!file) throw new Error('GITHUB_ENV is not set (run inside GitHub Actions)')
  appendFileSync(file, `${name}=${value}\n`)
}

function db() {
  const url = need('DATABASE_URL')
  return postgres(url, { max: 1, ssl: sslFor(url), onnotice: () => {} })
}

/** Repository secrets arrive as RAW_*; the exact values go to $GITHUB_ENV under the names the steps use. */
async function check() {
  const env = process.env
  const { inputs, problems, warnings } = normalizeInputs({
    accessToken: env.RAW_SUPABASE_ACCESS_TOKEN,
    projectRef: env.RAW_SUPABASE_PROJECT_REF,
    databaseUrl: env.RAW_SUPABASE_DB_URL,
    cfApiToken: env.RAW_CLOUDFLARE_API_TOKEN,
    cfAccountId: env.RAW_CLOUDFLARE_ACCOUNT_ID,
    demoPassword: env.RAW_DEMO_OWNER_PASSWORD,
    llmApiKey: env.RAW_LLM_API_KEY,
    pagesProject: env.PAGES_PROJECT,
  })
  if (problems.length) {
    for (const p of problems) console.log(`::error::${p}`)
    throw new Error(`Секреты репозитория: ${problems.length} ${problems.length === 1 ? 'ошибка' : 'ошибки'} — исправьте в Settings → Secrets and variables → Actions и запустите снова (подробности выше; DEPLOY-IN-BROWSER.md, шаг 3).`)
  }
  for (const value of [inputs.accessToken, inputs.databaseUrl, inputs.cfApiToken, inputs.cfAccountId, inputs.demoPassword, inputs.llmApiKey, inputs.projectRef]) if (value) mask(value)
  for (const w of warnings) console.log(`::warning::${w}`)
  await probeDatabase(inputs.databaseUrl)
  exportEnv('SUPABASE_ACCESS_TOKEN', inputs.accessToken)
  exportEnv('SUPABASE_PROJECT_REF', inputs.projectRef)
  exportEnv('DATABASE_URL', inputs.databaseUrl)
  exportEnv('CLOUDFLARE_API_TOKEN', inputs.cfApiToken)
  exportEnv('CLOUDFLARE_ACCOUNT_ID', inputs.cfAccountId)
  exportEnv('TENANT_DEMO_OWNER_PASSWORD', inputs.demoPassword)
  if (inputs.llmApiKey) exportEnv('LLM_API_KEY', inputs.llmApiKey)
  console.log(`✓ секреты на месте и в правильном виде${inputs.llmApiKey ? ' (умный помощник включён)' : ' (умный помощник — по шаблонам, LLM_API_KEY не задан)'}`)
}

/** One cheap query, so a wrong connection string is reported before anything is deployed. */
async function probeDatabase(url: string) {
  const sql = postgres(url, { max: 1, ssl: sslFor(url), connect_timeout: 20, onnotice: () => {} })
  try {
    await sql`select 1`
    console.log('✓ база данных отвечает')
  } catch (e) {
    throw new Error(explainDbError(e, url), { cause: e })
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

const WRANGLER = ['dlx', 'wrangler@4.146.0']

function wrangler(args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync('pnpm', [...WRANGLER, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

/** Creates the Pages project once and exports the site address (custom domain or the real *.pages.dev). */
/** The line wrangler marks as the error (ANSI colours stripped), or its last lines. */
function wranglerError(out: string): string {
  const lines = stripVTControlCharacters(out).split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.find((l) => l.startsWith('✘')) ?? lines.slice(-3).join(' ')
}

async function pages() {
  const project = need('PAGES_PROJECT')
  const created = wrangler(['pages', 'project', 'create', project, '--production-branch=main'])
  if (!created.ok && !/already exists/i.test(created.out)) throw new Error(`Cloudflare Pages: ${wranglerError(created.out)}`)
  console.log(created.ok ? `✓ Pages project ${project} created` : `✓ Pages project ${project} exists`)
  const list = wrangler(['pages', 'project', 'list', '--json'])
  if (!list.ok) throw new Error(`Cloudflare Pages: ${wranglerError(list.out)}`)
  const domain = pickPagesDomain(JSON.parse(list.out.slice(list.out.indexOf('['))), project)
  const custom = process.env.CUSTOM_APP_URL?.trim()
  const appUrl = custom ? new URL(custom).origin : `https://${domain}`
  exportEnv('APP_URL', appUrl)
  console.log(`✓ сайт: ${appUrl}${custom ? ` (pages.dev: https://${domain})` : ''}`)
}

async function keys() {
  const ref = need('SUPABASE_PROJECT_REF')
  const out = execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  const { anonKey, serviceRoleKey } = pickJwtKeys(JSON.parse(out.slice(out.indexOf('['))))
  mask(serviceRoleKey)
  exportEnv('SUPABASE_ANON_KEY', anonKey)
  exportEnv('SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey)
  console.log('✓ API keys received (service role key is masked)')
}

async function extensions() {
  const sql = db()
  try {
    for (const stmt of ['create extension if not exists pg_cron with schema pg_catalog', 'create extension if not exists pg_net with schema extensions']) {
      try {
        await sql.unsafe(stmt)
        console.log(`✓ ${stmt}`)
      } catch (e) {
        // Booking works without them; only scheduled notifications would not run.
        console.log(`::warning::${stmt}: ${(e as Error).message}. Уведомления по расписанию не заработают, пока расширение не включено (Database → Extensions).`)
      }
    }
  } finally {
    await sql.end()
  }
}

async function finalize() {
  const envFile = flag('out')
  if (!envFile) throw new Error('--out=<path> is required')
  const projectUrl = `https://${need('SUPABASE_PROJECT_REF')}.supabase.co`
  const sql = db()
  try {
    const names = Object.keys(VAULT_SECRETS) as VaultName[]
    const rows = await sql<{ name: VaultName; decrypted_secret: string }[]>`select name, decrypted_secret from vault.decrypted_secrets where name in ${sql(names)}`
    const existing = Object.fromEntries(rows.map((r) => [r.name, r.decrypted_secret]))
    const { values, created } = await planSecrets(existing, {
      random: (n) => randomBytes(n).toString('base64url'),
      vapid: generateVapidKeys,
    })
    for (const v of Object.values(values)) mask(v)
    for (const name of created) {
      const [old] = await sql<{ id: string }[]>`select id from vault.secrets where name = ${name}`
      if (old) await sql`select vault.update_secret(${old.id}::uuid, ${values[name]})`
      else await sql`select vault.create_secret(${values[name]}, ${name})`
    }
    console.log(created.length ? `✓ new server secrets stored in Vault: ${created.join(', ')}` : '✓ server secrets: kept from Vault (not rotated)')

    const [url] = await sql<{ id: string; decrypted_secret: string }[]>`select id, decrypted_secret from vault.decrypted_secrets where name = 'project_url'`
    if (!url) await sql`select vault.create_secret(${projectUrl}, 'project_url')`
    else if (url.decrypted_secret !== projectUrl) await sql`select vault.update_secret(${url.id}::uuid, ${projectUrl})`
    console.log(`✓ Vault project_url = ${projectUrl}`)

    const [{ r }] = (await sql`select private.ensure_schedules() as r`) as unknown as [{ r: string }]
    console.log(r === 'scheduled' ? '✓ Cron: notify-dispatch (every minute), housekeeping (daily)' : `::warning::Cron: ${r}`)

    const env = functionEnv({
      vault: values,
      appUrl: need('APP_URL'),
      llm: { apiKey: process.env.LLM_API_KEY?.trim(), model: process.env.LLM_MODEL?.trim(), baseUrl: process.env.LLM_BASE_URL?.trim() },
    })
    writeFileSync(envFile, toDotenv(env), { mode: 0o600 })
    console.log(`✓ Edge Function env: ${Object.keys(env).join(', ')}`)
  } finally {
    await sql.end()
  }
}

async function auth() {
  const ref = need('SUPABASE_PROJECT_REF')
  const appUrl = new URL(need('APP_URL')).origin
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${need('SUPABASE_ACCESS_TOKEN')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ site_url: appUrl, uri_allow_list: `${appUrl}/**`, disable_signup: true }),
  })
  if (!res.ok) throw new Error(`Auth config: HTTP ${res.status} ${await res.text()}`)
  console.log(`✓ Auth: site URL ${appUrl}, redirects ${appUrl}/**, public sign-up off`)
}

function summary() {
  const appUrl = new URL(need('APP_URL')).origin
  const dir = join(import.meta.dirname, '../../tenants')
  const studios = readdirSync(dir)
    .filter((d) => !d.startsWith('_') && existsSync(join(dir, d, 'business.json')))
    .map((d) => JSON.parse(readFileSync(join(dir, d, 'business.json'), 'utf8')) as { slug: string; name: string; status: string; owners: { email: string }[] })
    .filter((b) => b.status !== 'draft')
  const lines = [
    '## Сайт опубликован',
    '',
    '| Студия | Режим | Сайт для клиентов | Кабинет | Вход владельца |',
    '|---|---|---|---|---|',
    ...studios.map((b) => `| ${b.name} | ${b.status} | ${appUrl}/s/${b.slug}/ | ${appUrl}/s/${b.slug}/owner/ | ${b.owners[0]?.email ?? '—'} |`),
    '',
    'Пароль демо-владельцев — значение секрета `DEMO_OWNER_PASSWORD`. Ссылку для клиентов и QR-код владелец найдёт в кабинете: «Студия» → «Ссылка для клиентов».',
  ]
  console.log(lines.join('\n'))
}

const commands: Record<string, () => unknown> = { check, pages, keys, extensions, finalize, auth, summary }
const run = command ? commands[command] : undefined
if (!run) {
  console.error(`usage: tsx scripts/deploy/cli.ts ${Object.keys(commands).join('|')}`)
  process.exit(2)
}
Promise.resolve()
  .then(run)
  .catch((e: unknown) => {
    console.log(`::error::${(e as Error).message}`)
    process.exit(1)
  })
