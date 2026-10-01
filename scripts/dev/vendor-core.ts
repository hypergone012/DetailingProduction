/**
 * Copies packages/core/src (runtime files only) into supabase/functions/_vendor/core so
 * every Edge Function import stays inside supabase/functions, which is what the Supabase
 * CLI bundles on deploy. Generated and git-ignored; run by functions:check/serve and deploy.
 */
import { cpSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dirname, '../../packages/core/src')
const OUT = join(import.meta.dirname, '../../supabase/functions/_vendor/core')
rmSync(OUT, { recursive: true, force: true })
cpSync(SRC, OUT, { recursive: true, filter: (p) => !p.endsWith('.test.ts') })
console.log(`vendored @dp/core (${readdirSync(OUT).length} entries)`)
