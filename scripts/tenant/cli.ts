/**
 * Tenant pipeline: copy business config -> replace images -> validate -> publish -> verify.
 *
 *   pnpm tenant:new <slug> --name "Studio name" [--timezone Europe/Moscow]
 *   pnpm tenant:validate [<slug>... | --all]
 *   pnpm tenant:publish [<slug>... | --all] [--overwrite] [--reseed-demo] [--dry-run] [--reset-demo-password]
 *   pnpm tenant:verify [<slug>... | --all] [--app-url=http://127.0.0.1:4173]
 *   pnpm tenant:shells [--dist=apps/web/dist]
 *   pnpm tenant:remove <slug>... [--dry-run]   (demo/draft studios only; delete tenants/<slug>/ first)
 *
 * Server credentials come from SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or the local stack).
 */
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { businessSchema } from '@dp/core'
import { z } from 'zod'
import { crossCheck, loadTenant, tenantSlugs, TENANTS_DIR, type LoadedTenant, type Problem } from './lib/load.ts'
import { publishTenant } from './lib/publish.ts'
import { writeShells } from './lib/shells.ts'
import { deleteUser, loadEnv, removeObjects, rpc } from './lib/supabase.ts'
import { verifyTenants, type CheckLevel } from './lib/verify.ts'

const [command, ...rest] = process.argv.slice(2)
const flags = new Map<string, string | true>()
const positional: string[] = []
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]!
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=', 2) as [string, string | undefined]
    if (v !== undefined) flags.set(k, v)
    else if (rest[i + 1] && !rest[i + 1]!.startsWith('--') && ['name', 'timezone', 'from', 'app-url', 'dist'].includes(k)) flags.set(k, rest[++i]!)
    else flags.set(k, true)
  } else positional.push(a)
}
const flag = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string) : undefined)

function selectSlugs(): string[] {
  if (flags.has('all') || positional.length === 0) return tenantSlugs()
  return positional
}

function printProblems(slug: string, problems: Problem[]) {
  for (const p of problems) console.log(`  ${p.level === 'error' ? '✗' : '!'} ${slug}: ${p.path} — ${p.message}`)
}

async function validateAll(slugs: string[]): Promise<LoadedTenant[]> {
  const loaded = await Promise.all(slugs.map((s) => loadTenant(s)))
  const all = slugs.length === tenantSlugs().length ? loaded : await Promise.all(tenantSlugs().map((s) => loadTenant(s)))
  const cross = crossCheck(all)
  let errors = 0
  for (const t of loaded) {
    const problems = [...t.problems, ...cross.filter((c) => c.path === t.slug)]
    t.problems = problems
    const e = problems.filter((p) => p.level === 'error').length
    errors += e
    console.log(`${e === 0 ? '✓' : '✗'} ${t.slug}${t.business ? ` (${t.business.name}, ${t.business.status}, ${t.business.services.length} услуг)` : ''}`)
    printProblems(t.slug, problems)
  }
  if (errors > 0) {
    console.log(`\n${errors} ошибок — исправьте business.json/ассеты и повторите.`)
    process.exitCode = 1
  }
  return loaded
}

async function cmdNew() {
  const slug = positional[0]
  const name = flag('name')
  if (!slug || !name) throw new Error('usage: pnpm tenant:new <slug> --name "Studio name" [--timezone Europe/Moscow]')
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) throw new Error('slug: 1-40 символов, латиница в нижнем регистре, цифры, дефис')
  const dir = join(TENANTS_DIR, slug)
  if (existsSync(dir)) throw new Error(`tenants/${slug} уже существует`)
  const from = flag('from') ?? '_template'
  cpSync(join(TENANTS_DIR, from), dir, { recursive: true, filter: (p) => !p.endsWith('art.json') && !p.endsWith('demo-seed.json') })
  const file = join(dir, 'business.json')
  const b = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  b.id = randomUUID()
  b.slug = slug
  b.name = name
  b.status = 'draft'
  if (flag('timezone')) b.timezone = flag('timezone')
  delete b.demo
  writeFileSync(file, JSON.stringify(b, null, 2) + '\n')
  console.log(`✓ tenants/${slug} создан (id ${b.id as string}, статус draft)

Дальше:
  1. Отредактируйте tenants/${slug}/business.json: контакты, часы, ресурсы, услуги, владелец.
  2. Замените фото в tenants/${slug}/assets/ (logo, icon, hero, gallery, services).
  3. pnpm tenant:validate ${slug}
  4. pnpm tenant:publish ${slug}
  5. pnpm tenant:verify ${slug}`)
}

async function cmdValidate() {
  await validateAll(selectSlugs())
}

async function cmdPublish() {
  const loaded = await validateAll(selectSlugs())
  if (process.exitCode) return
  const env = loadEnv()
  const demoOwnerPassword = process.env.TENANT_DEMO_OWNER_PASSWORD ?? (env.local ? 'demo-owner-2026' : null)
  for (const t of loaded) {
    const r = await publishTenant(env, t, {
      overwrite: flags.has('overwrite'),
      reseedDemo: flags.has('reseed-demo'),
      dryRun: flags.has('dry-run'),
      resetDemoPassword: flags.has('reset-demo-password'),
      demoOwnerPassword,
      log: (l) => console.log(l),
    })
    console.log(`✓ ${r.slug} → ${r.status} (config ${r.configHash.slice(0, 12)})`)
    const list = (label: string, items: string[]) => items.length && console.log(`  ${label}: ${items.join(', ')}`)
    list('created', r.created)
    list('updated', r.updated)
    list('kept owner edits', r.kept_owner_edits)
    list('deactivated', r.deactivated)
    list('deleted', r.deleted)
    if (!r.created.length && !r.updated.length && !r.deleted.length && !r.deactivated.length) console.log('  no changes (idempotent republish)')
    for (const o of r.owners) {
      // A GitHub Actions log can be public: a password link must never land there.
      const link = !o.link ? '' : process.env.GITHUB_ACTIONS ? '\n    ссылка для установки пароля не печатается в лог GitHub Actions; владелец нажимает «Забыли пароль?» на входе в кабинет (нужен SMTP, DEPLOY-IN-BROWSER.md)' : `\n    одноразовая ссылка для установки пароля: ${o.link}`
      console.log(`  owner ${o.email}: ${o.created ? 'created' : 'exists'}${o.passwordReset ? ' — пароль входа сброшен на значение DEMO_OWNER_PASSWORD' : ''}${link}`)
    }
    if (r.status === 'demo' && demoOwnerPassword && r.owners.some((o) => o.created)) {
      console.log(`  demo owner password: ${env.local ? demoOwnerPassword : '(TENANT_DEMO_OWNER_PASSWORD)'}`)
    }
    if (r.seed) console.log(`  demo seed: ${JSON.stringify(r.seed)}`)
  }
}

async function cmdVerify() {
  const env = loadEnv()
  const slugs = flags.has('all') || positional.length === 0 ? ('all' as const) : positional
  const local = new Map<string, LoadedTenant>()
  for (const slug of tenantSlugs()) local.set(slug, await loadTenant(slug))
  const appUrl = flag('app-url')?.replace(/\/$/, '') ?? null
  const results = await verifyTenants(env, slugs, local, { appUrl })
  const mark: Record<CheckLevel, string> = { pass: '✓', fail: '✗', warn: '!', skip: '–' }
  const totals: Record<CheckLevel, number> = { pass: 0, fail: 0, warn: 0, skip: 0 }
  for (const r of results) {
    console.log(`\n${r.slug}`)
    for (const c of r.checks) {
      totals[c.level]++
      console.log(`  ${mark[c.level]} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
    }
  }
  console.log(`\n${totals.pass} passed, ${totals.fail} failed, ${totals.warn} warnings, ${totals.skip} skipped`)
  if (totals.fail > 0) process.exitCode = 1
}

async function cmdShells() {
  const dist = flag('dist') ?? join(import.meta.dirname, '../../apps/web/dist')
  await writeShells(loadEnv(), dist, (l) => console.log(l))
}

interface RemovePlan {
  found: boolean
  removed?: boolean
  tenant_id?: string
  name?: string
  status?: string
  bookings?: number
  customers?: number
  objects?: { bucket: string; path: string }[]
  orphan_users?: string[]
}

/**
 * Removes studios that are no longer wanted: database rows (everything cascades from the
 * tenant), Storage objects under the studio's prefix, and the Auth accounts of members who
 * belong to no other studio. The database refuses a studio that is or ever was live.
 * Running it again for a studio that is already gone is a no-op.
 */
async function cmdRemove() {
  if (positional.length === 0) throw new Error('укажите студию: pnpm tenant:remove <slug>')
  const env = loadEnv()
  const dryRun = flags.has('dry-run')
  for (const slug of positional) {
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) throw new Error(`«${slug}» не похоже на адрес студии (латиница, цифры, дефис)`)
    if (existsSync(join(TENANTS_DIR, slug, 'business.json'))) {
      throw new Error(`папка tenants/${slug} ещё в репозитории: удалите её, иначе следующий Deploy опубликует студию заново`)
    }
    const plan = await rpc<RemovePlan>(env, 'api_admin_remove_tenant', { p_slug: slug, p_dry_run: true })
    if (!plan.found) {
      console.log(`✓ ${slug}: такой студии в базе нет — удалять нечего`)
      continue
    }
    const objects = plan.objects ?? []
    const users = plan.orphan_users ?? []
    console.log(`${dryRun ? '•' : '✓'} ${slug} (${plan.name}, ${plan.status}): записей ${plan.bookings}, клиентов ${plan.customers}, файлов ${objects.length}, входов в кабинет ${users.length}`)
    if (dryRun) {
      console.log('  --dry-run: ничего не удалено')
      continue
    }
    for (const bucket of new Set(objects.map((o) => o.bucket))) {
      await removeObjects(env, bucket, objects.filter((o) => o.bucket === bucket).map((o) => o.path))
    }
    await rpc(env, 'api_admin_remove_tenant', { p_slug: slug, p_dry_run: false })
    let usersRemoved = 0
    for (const id of users) {
      try {
        await deleteUser(env, id)
        usersRemoved++
      } catch (e) {
        console.log(`  ! вход в кабинет не удалён: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    console.log(`  удалено: студия и все её данные, файлов ${objects.length}, входов в кабинет ${usersRemoved}`)
  }
}

/** Writes tenants/business.schema.json (editor autocompletion; Zod remains the authority). */
async function cmdSchema() {
  const json = z.toJSONSchema(businessSchema, { io: 'input', unrepresentable: 'any' })
  writeFileSync(join(TENANTS_DIR, 'business.schema.json'), JSON.stringify(json, null, 2) + '\n')
  console.log('✓ tenants/business.schema.json')
}

const commands: Record<string, () => Promise<void>> = {
  new: cmdNew,
  validate: cmdValidate,
  publish: cmdPublish,
  verify: cmdVerify,
  shells: cmdShells,
  remove: cmdRemove,
  schema: cmdSchema,
}

const run = commands[command ?? '']
if (!run) {
  console.error(`unknown command "${command ?? ''}". Commands: ${Object.keys(commands).join(', ')}`)
  process.exit(2)
}
run().catch((e: unknown) => {
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
