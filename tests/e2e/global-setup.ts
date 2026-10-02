import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { tenantConfig } from '../fixtures/tenant.ts'

const ROOT = join(import.meta.dirname, '../..')
const GATEWAY = 'http://127.0.0.1:54321'
export const E2E_FILE = join(ROOT, '.local/e2e-tenant.json')

export interface E2eStudio {
  id: string
  slug: string
  name: string
  timezone: string
  ownerEmail: string
  ownerPassword: string
  serviceName: string
}

async function up(url: string, headers: Record<string, string> = {}): Promise<boolean> {
  try {
    const r = await fetch(url, { headers })
    await r.body?.cancel()
    return r.status < 500
  } catch {
    return false
  }
}

export default async function globalSetup() {
  for (const [name, url] of [
    ['auth', 'http://127.0.0.1:54324/health'],
    ['rest', 'http://127.0.0.1:54425/ready'],
    ['storage', 'http://127.0.0.1:54326/status'],
  ] as const) {
    if (!(await up(url))) throw new Error(`local stack is not running (${name}). Run: pnpm stack start`)
  }
  const keys = JSON.parse(readFileSync(join(ROOT, '.local/keys.json'), 'utf8')) as { anonKey: string; serviceRoleKey: string }
  let gateway: ChildProcess | null = null
  if (!(await up(`${GATEWAY}/functions/v1/public-api/push/config`, { apikey: keys.anonKey }))) {
    gateway = spawn('pnpm', ['-s', 'functions:serve'], { cwd: ROOT, stdio: 'ignore', detached: true })
    for (let i = 0; i < 120 && !(await up(`${GATEWAY}/functions/v1/public-api/push/config`, { apikey: keys.anonKey })); i++) await new Promise((r) => setTimeout(r, 250))
  }

  // An isolated studio with an owner whose password only this run knows.
  const svc = { apikey: keys.serviceRoleKey, authorization: `Bearer ${keys.serviceRoleKey}`, 'content-type': 'application/json' }
  const ownerEmail = `owner-${randomUUID()}@e2e.test`
  const ownerPassword = `e2e-${randomUUID()}`
  const user = (await fetch(`${GATEWAY}/auth/v1/admin/users`, { method: 'POST', headers: svc, body: JSON.stringify({ email: ownerEmail, password: ownerPassword, email_confirm: true }) }).then((r) => r.json())) as { id: string }
  const id = randomUUID()
  const name = 'Студия E2E'
  const config = tenantConfig(id, user.id, {
    slug: `e2e-${id.slice(0, 8)}`,
    name,
    status: 'demo',
    services: [{ key: 'wash', name: 'Мойка кузова', duration_min: 60, buffer_after_min: 15, price_cents: 250000 }] as never,
  })
  const pub = await fetch(`${GATEWAY}/rest/v1/rpc/api_admin_publish_tenant`, { method: 'POST', headers: svc, body: JSON.stringify({ p_config: config, p_config_hash: 'e2e', p_overwrite: false }) })
  if (!pub.ok) throw new Error(`publish failed: ${pub.status} ${await pub.text()}`)
  const studio: E2eStudio = { id, slug: config.slug as string, name, timezone: config.timezone as string, ownerEmail, ownerPassword, serviceName: 'Мойка кузова' }
  writeFileSync(E2E_FILE, JSON.stringify(studio))

  return async () => {
    const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54322/dp_dev', { max: 1, onnotice: () => {} })
    try {
      await sql`delete from public.tenants where id = ${id}`
      await sql`delete from auth.users where id = ${user.id}`
    } finally {
      await sql.end()
    }
    if (gateway?.pid) process.kill(-gateway.pid)
  }
}
