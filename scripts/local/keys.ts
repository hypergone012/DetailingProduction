/**
 * Local-only Supabase API keys: HS256 JWTs signed with the local JWT secret, the same
 * shape the Supabase CLI prints for `supabase start`. They are worthless outside this
 * machine's stack. Writes .local/keys.json and prints `export` lines.
 *
 * Usage: tsx scripts/local/keys.ts [--export]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SignJWT } from 'jose'

export const LOCAL_JWT_SECRET = process.env.DP_JWT_SECRET ?? 'local-dev-jwt-secret-with-at-least-32-characters'
export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321'

async function sign(role: 'anon' | 'service_role') {
  return new SignJWT({ role, iss: 'supabase-local' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(1_700_000_000)
    .setExpirationTime(2_000_000_000)
    .sign(new TextEncoder().encode(LOCAL_JWT_SECRET))
}

export async function localKeys() {
  return { url: LOCAL_SUPABASE_URL, anonKey: await sign('anon'), serviceRoleKey: await sign('service_role'), jwtSecret: LOCAL_JWT_SECRET }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const keys = await localKeys()
  const dir = join(import.meta.dirname, '../../.local')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'keys.json'), JSON.stringify(keys, null, 2))
  if (process.argv.includes('--export')) {
    console.log(`export DP_ANON_KEY=${keys.anonKey}\nexport DP_SERVICE_KEY=${keys.serviceRoleKey}`)
  } else {
    console.log(JSON.stringify(keys, null, 2))
  }
}
