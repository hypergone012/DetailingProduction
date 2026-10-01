import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'
import { migrate } from '../../scripts/db/migrate.ts'

/**
 * Creates a throw-away database on the local cluster (scripts/local/stack.sh must be
 * running Postgres), with the Supabase platform bootstrap and the real GoTrue auth schema,
 * then applies every project migration. Each `pnpm test:db` run starts from scratch.
 */
export default async function setup(project: TestProject) {
  const db = process.env.DP_TEST_DB ?? 'dp_test_db'
  const root = join(import.meta.dirname, '../..')
  execFileSync('bash', [join(root, 'scripts/local/stack.sh'), 'createdb', db], { stdio: 'pipe' })
  const url = `postgres://postgres@127.0.0.1:${process.env.DP_PG_PORT ?? '54322'}/${db}`
  await migrate(url)
  project.provide('databaseUrl', url)
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}
