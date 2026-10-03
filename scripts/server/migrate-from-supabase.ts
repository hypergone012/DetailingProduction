/**
 * Moves a studio platform from the hosted Supabase project to the self-hosted server — once,
 * before the server goes live (scripts/server/deploy.sh, DP_MIGRATE_FROM_SUPABASE=1).
 *
 *   - data: every table of the `public` and `private` schemas, owners' accounts (auth.users and
 *     auth.identities: the same passwords keep working), sequence positions;
 *   - files: every object of the studio buckets (photos, logos), through both Storage APIs;
 *   - server secrets from Supabase Vault (--secrets-out=<file>): booking links and push
 *     subscriptions stay valid only with the same ACCESS_TOKEN_SECRET and VAPID keys.
 *
 * Refuses a server that already has accounts or bookings (it would overwrite live data).
 * Prints counts and names only, never values.
 *
 * Env: SOURCE_DATABASE_URL, SOURCE_SUPABASE_URL, SOURCE_SERVICE_ROLE_KEY (hosted project);
 *      DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the server, through the SSH tunnel).
 */
import { chmodSync, writeFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import postgres from 'postgres'
import { sslFor } from '../db/migrate.ts'
import { VAULT_SECRETS, type VaultName } from '../deploy/plan.ts'

const BUCKETS = ['public-media', 'private-media']
const SCHEMAS = ['public', 'private']
const AUTH_TABLES = ['users', 'identities']

function need(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`не задана переменная ${name}`)
  return v.replace(/\/$/, '')
}

const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

type Sql = ReturnType<typeof postgres>

async function columns(sql: Sql, schema: string, table: string): Promise<string[]> {
  const rows = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = ${schema} and table_name = ${table} and is_generated = 'NEVER'
    order by ordinal_position`
  return rows.map((r) => r.column_name)
}

async function tables(sql: Sql): Promise<{ schema: string; table: string }[]> {
  const rows = await sql<{ table_schema: string; table_name: string }[]>`
    select table_schema, table_name from information_schema.tables
    where table_schema in ${sql(SCHEMAS)} and table_type = 'BASE TABLE'
    order by table_schema, table_name`
  return [...AUTH_TABLES.map((t) => ({ schema: 'auth', table: t })), ...rows.map((r) => ({ schema: r.table_schema, table: r.table_name }))]
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`

async function copyData(source: Sql, target: Sql, force: boolean): Promise<void> {
  const [busy] = await target<{ users: number; bookings: number }[]>`
    select (select count(*) from auth.users)::int as users, (select count(*) from public.bookings)::int as bookings`
  if ((busy!.users > 0 || busy!.bookings > 0) && !force) {
    throw new Error(`на сервере уже есть данные (${busy!.users} аккаунтов, ${busy!.bookings} записей): перенос остановлен, чтобы ничего не затереть`)
  }
  const list = await tables(target)
  const sourceTables = new Set((await tables(source)).map((t) => `${t.schema}.${t.table}`))
  await target.begin(async (tx) => {
    // Rows go in as they are: no triggers, no foreign-key checks until every table is there.
    await tx`set local session_replication_role = replica`
    await tx.unsafe(`truncate ${list.map((t) => `${ident(t.schema)}.${ident(t.table)}`).join(', ')} cascade`)
    for (const { schema, table } of list) {
      const name = `${schema}.${table}`
      if (!sourceTables.has(name)) {
        console.log(`  ${name}: нет в источнике — пропущено`)
        continue
      }
      const targetCols = new Set(await columns(tx as unknown as Sql, schema, table))
      const cols = (await columns(source, schema, table)).filter((c) => targetCols.has(c))
      const list = cols.map(ident).join(', ')
      const from = await source.unsafe(`copy (select ${list} from ${ident(schema)}.${ident(table)}) to stdout`).readable()
      const to = await tx.unsafe(`copy ${ident(schema)}.${ident(table)} (${list}) from stdin`).writable()
      await pipeline(from, to)
    }
    // Sequences continue where the hosted project stopped.
    const seqs = await source<{ schema: string; name: string; last_value: string | null; is_called: boolean }[]>`
      select schemaname as schema, sequencename as name, last_value::text, (last_value is not null) as is_called
      from pg_sequences where schemaname in ${source(SCHEMAS)}`
    for (const s of seqs) {
      if (s.last_value == null) continue
      await tx.unsafe(`select setval('${ident(s.schema)}.${ident(s.name)}', ${BigInt(s.last_value).toString()}, true)`)
    }
  })
  // The same number of rows on both sides, table by table.
  const problems: string[] = []
  for (const { schema, table } of list) {
    if (!sourceTables.has(`${schema}.${table}`)) continue
    const q = `select count(*)::int as n from ${ident(schema)}.${ident(table)}`
    const [a] = await source.unsafe<{ n: number }[]>(q)
    const [b] = await target.unsafe<{ n: number }[]>(q)
    console.log(`  ${schema}.${table}: ${b!.n}`)
    if (a!.n !== b!.n) problems.push(`${schema}.${table}: источник ${a!.n}, сервер ${b!.n}`)
  }
  if (problems.length) throw new Error(`не совпало число строк:\n${problems.join('\n')}`)
}

async function copyFiles(source: Sql): Promise<void> {
  const srcUrl = need('SOURCE_SUPABASE_URL')
  const srcKey = need('SOURCE_SERVICE_ROLE_KEY')
  const dstUrl = need('SUPABASE_URL')
  const dstKey = need('SUPABASE_SERVICE_ROLE_KEY')
  const objects = await source<{ bucket_id: string; name: string; mimetype: string | null; cache_control: string | null }[]>`
    select bucket_id, name, metadata->>'mimetype' as mimetype, metadata->>'cacheControl' as cache_control
    from storage.objects where bucket_id in ${source(BUCKETS)} order by bucket_id, name`
  const path = (o: { bucket_id: string; name: string }) => `${encodeURIComponent(o.bucket_id)}/${o.name.split('/').map(encodeURIComponent).join('/')}`
  let done = 0
  let bytes = 0
  const queue = [...objects]
  const worker = async () => {
    for (let o = queue.shift(); o; o = queue.shift()) {
      const res = await fetch(`${srcUrl}/storage/v1/object/authenticated/${path(o)}`, { headers: { apikey: srcKey, authorization: `Bearer ${srcKey}` } })
      if (!res.ok) throw new Error(`файл ${o.bucket_id}/${o.name}: скачивание — HTTP ${res.status}`)
      const body = new Uint8Array(await res.arrayBuffer())
      const up = await fetch(`${dstUrl}/storage/v1/object/${path(o)}`, {
        method: 'POST',
        headers: {
          apikey: dstKey,
          authorization: `Bearer ${dstKey}`,
          'content-type': o.mimetype ?? res.headers.get('content-type') ?? 'application/octet-stream',
          'cache-control': o.cache_control ? `max-age=${o.cache_control.replace(/^max-age=/, '')}` : 'max-age=3600',
          'x-upsert': 'true',
        },
        body,
      })
      if (!up.ok) throw new Error(`файл ${o.bucket_id}/${o.name}: загрузка — HTTP ${up.status} ${await up.text()}`)
      done++
      bytes += body.byteLength
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  console.log(`  файлов: ${done} (${(bytes / 1048576).toFixed(1)} МБ)`)
}

async function copySecrets(source: Sql, out: string): Promise<void> {
  const names = Object.keys(VAULT_SECRETS) as VaultName[]
  const rows = await source<{ name: VaultName; decrypted_secret: string }[]>`
    select name, decrypted_secret from vault.decrypted_secrets where name in ${source(names)}`
  const lines = rows.filter((r) => r.decrypted_secret && !/[\r\n]/.test(r.decrypted_secret)).map((r) => `${VAULT_SECRETS[r.name]}=${r.decrypted_secret}`)
  writeFileSync(out, lines.join('\n') + '\n', { mode: 0o600 })
  chmodSync(out, 0o600)
  console.log(`  секреты: ${rows.map((r) => VAULT_SECRETS[r.name]).join(', ') || 'нет'}`)
}

async function main() {
  const sourceUrl = need('SOURCE_DATABASE_URL')
  const targetUrl = need('DATABASE_URL')
  const source = postgres(sourceUrl, { max: 1, ssl: sslFor(sourceUrl), onnotice: () => {} })
  const target = postgres(targetUrl, { max: 1, ssl: sslFor(targetUrl), onnotice: () => {} })
  try {
    console.log('== данные')
    await copyData(source, target, process.argv.includes('--force'))
    console.log('== файлы')
    await copyFiles(source)
    const out = flag('secrets-out')
    if (out) {
      console.log('== секреты сервера')
      await copySecrets(source, out)
    }
    console.log('перенос завершён')
  } finally {
    await source.end()
    await target.end()
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
