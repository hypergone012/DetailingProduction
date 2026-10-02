/**
 * Applies supabase/migrations/*.sql in filename order and records them in
 * supabase_migrations.schema_migrations, the same ledger the Supabase CLI uses,
 * so a database migrated locally and one migrated with `supabase db push` agree.
 *
 * Usage: DATABASE_URL=postgres://... tsx scripts/db/migrate.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { withRetry } from '../deploy/retry.ts'

export const MIGRATIONS_DIR = join(import.meta.dirname, '../../supabase/migrations')

export function listMigrations(): { version: string; name: string; path: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const [version, ...rest] = f.replace(/\.sql$/, '').split('_')
      return { version: version!, name: rest.join('_'), path: join(MIGRATIONS_DIR, f) }
    })
}

/** Hosted Postgres (Supabase pooler) gets TLS; the local stack on 127.0.0.1 does not. */
export function sslFor(databaseUrl: string): 'require' | false {
  const host = new URL(databaseUrl).hostname
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' ? false : 'require'
}

export async function migrate(databaseUrl: string, log: (m: string) => void = () => {}): Promise<number> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {}, ssl: sslFor(databaseUrl) })
  try {
    await sql.unsafe(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key,
        statements text[],
        name text
      );`)
    const applied = new Map(
      (await sql<{ version: string; statements: string[] | null }[]>`select version, statements from supabase_migrations.schema_migrations`).map(
        (r) => [r.version, r.statements?.join('') ?? null],
      ),
    )
    // An applied migration must never change: the database would silently keep the old code.
    const drifted = listMigrations().filter((m) => {
      const stored = applied.get(m.version)
      return stored != null && stored !== readFileSync(m.path, 'utf8')
    })
    if (drifted.length > 0) {
      throw new Error(
        `migration(s) edited after being applied to this database: ${drifted.map((m) => `${m.version}_${m.name}`).join(', ')}.\n` +
          'Add a new migration instead. For a disposable local database: pnpm stack reset && pnpm db:migrate',
      )
    }
    let count = 0
    for (const m of listMigrations()) {
      if (applied.has(m.version)) continue
      const body = readFileSync(m.path, 'utf8')
      await sql.begin(async (tx) => {
        await tx.unsafe(body)
        await tx`insert into supabase_migrations.schema_migrations (version, name, statements) values (${m.version}, ${m.name}, ${[body]})`
      })
      log(`applied ${m.version}_${m.name}`)
      count++
    }
    // PostgREST caches the schema; tell it to reload (no-op when nobody listens).
    await sql`select pg_notify('pgrst', 'reload schema')`
    return count
  } finally {
    await sql.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54322/dp_dev'
  withRetry('миграции', () => migrate(url, console.log))
    .then((n) => console.log(n === 0 ? 'database is up to date' : `${n} migration(s) applied`))
    .catch((e: unknown) => {
      console.error(e)
      process.exit(1)
    })
}
