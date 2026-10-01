/**
 * Writes local-only configuration:
 *   .local/functions.env   server secrets for the Edge Functions run by the local gateway
 *   apps/web/.env.local    browser-safe VITE_* variables for the dev server
 * Existing values are kept, so secrets and VAPID keys stay stable across runs.
 *
 * Usage: pnpm stack:env
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateVapidKeys } from '@dp/core'
import { localKeys } from './keys.ts'

const ROOT = join(import.meta.dirname, '../..')

function readEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {}
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )
}

function writeEnv(file: string, header: string, values: Record<string, string>) {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, `${header}\n${Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n')}\n`)
}

const keys = await localKeys()
const fnFile = join(ROOT, '.local/functions.env')
const current = readEnv(fnFile)
const vapid = current.VAPID_PUBLIC_KEY && current.VAPID_PRIVATE_KEY ? { publicKey: current.VAPID_PUBLIC_KEY, privateKey: current.VAPID_PRIVATE_KEY } : await generateVapidKeys()
const fn: Record<string, string> = {
  SUPABASE_URL: keys.url,
  SUPABASE_ANON_KEY: keys.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: keys.serviceRoleKey,
  APP_URL: current.APP_URL ?? 'http://127.0.0.1:5173',
  ALLOWED_ORIGINS: current.ALLOWED_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173',
  ACCESS_TOKEN_SECRET: current.ACCESS_TOKEN_SECRET ?? randomBytes(32).toString('base64url'),
  DISPATCHER_SECRET: current.DISPATCHER_SECRET ?? randomBytes(24).toString('base64url'),
  TRUSTED_PROXY_HOPS: current.TRUSTED_PROXY_HOPS ?? '1',
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: current.VAPID_SUBJECT ?? 'mailto:local@example.test',
  ...(current.LLM_API_KEY ? { LLM_API_KEY: current.LLM_API_KEY } : {}),
  ...(current.LLM_BASE_URL ? { LLM_BASE_URL: current.LLM_BASE_URL } : {}),
  ...(current.LLM_MODEL ? { LLM_MODEL: current.LLM_MODEL } : {}),
}
writeEnv(fnFile, '# LOCAL ONLY. Server-side secrets for the local Edge Functions gateway. Never commit.', fn)
writeEnv(join(ROOT, 'apps/web/.env.local'), '# LOCAL ONLY. Browser-safe values (anon key is public by design).', {
  VITE_SUPABASE_URL: keys.url,
  VITE_SUPABASE_ANON_KEY: keys.anonKey,
})
console.log('wrote .local/functions.env and apps/web/.env.local')
