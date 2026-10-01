import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'

/**
 * API tests exercise the real HTTP path: gateway -> Edge Function handler (Deno) ->
 * PostgREST -> Postgres, plus GoTrue and Storage. They need the local stack running
 * (`pnpm stack start` after `pnpm stack init` + `pnpm db:migrate`). This setup starts a
 * dedicated gateway on :54331 that trusts a throw-away TLS certificate, so the dispatcher
 * can deliver real encrypted Web Push requests to a local HTTPS push service.
 */
const ROOT = join(import.meta.dirname, '../..')
const PORT = 54331
let gateway: ChildProcess | null = null

async function up(url: string): Promise<boolean> {
  try {
    const r = await fetch(url)
    await r.body?.cancel()
    return r.ok
  } catch {
    return false
  }
}

export default async function setup(project: TestProject) {
  for (const [name, url] of [
    ['auth', 'http://127.0.0.1:54324/health'],
    ['rest', 'http://127.0.0.1:54425/ready'],
    ['storage', 'http://127.0.0.1:54326/status'],
  ] as const) {
    if (!(await up(url))) throw new Error(`local stack is not running (${name}). Run: pnpm stack start`)
  }
  const local = join(ROOT, '.local')
  if (!existsSync(join(local, 'keys.json'))) execFileSync('npx', ['tsx', 'scripts/local/keys.ts'], { cwd: ROOT })
  if (!existsSync(join(local, 'functions.env'))) execFileSync('npx', ['tsx', 'scripts/local/env.ts'], { cwd: ROOT })
  execFileSync('npx', ['tsx', 'scripts/dev/vendor-core.ts'], { cwd: ROOT, stdio: 'pipe' })

  // Test-only PKI: a CA trusted by the test gateway (--cert) and a leaf for 127.0.0.1.
  const tls = join(local, 'test-tls-v2')
  mkdirSync(tls, { recursive: true })
  const f = (n: string) => join(tls, n)
  if (!existsSync(f('cert.pem'))) {
    const ssl = (args: string[]) => execFileSync('openssl', args, { stdio: 'pipe' })
    ssl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', f('ca-key.pem'),
      '-out', f('ca.pem'), '-days', '365', '-subj', '/CN=detailing-test-ca', '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign'])
    ssl(['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', f('key.pem'), '-out', f('leaf.csr'),
      '-subj', '/CN=127.0.0.1'])
    writeFileSync(f('leaf.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n')
    ssl(['x509', '-req', '-in', f('leaf.csr'), '-CA', f('ca.pem'), '-CAkey', f('ca-key.pem'), '-CAcreateserial', '-out', f('cert.pem'),
      '-days', '365', '-extfile', f('leaf.ext')])
  }

  const keys = JSON.parse(readFileSync(join(local, 'keys.json'), 'utf8')) as { anonKey: string; serviceRoleKey: string }
  const dispatcherSecret = 'test-dispatcher-secret-0123456789'
  // The real binary, not the node shim: killing a shim would leave the server running.
  const deno = join(ROOT, 'node_modules/deno/deno')
  if (await up(`http://127.0.0.1:${PORT}/health`)) throw new Error(`port ${PORT} is busy (a stale test gateway?)`)
  gateway = spawn(
    deno,
    ['run', '--allow-net', '--allow-env', '--allow-read', '--allow-write=.local', `--cert=${f('ca.pem')}`,
      '--config', 'supabase/functions/deno.json', 'scripts/dev/gateway.ts'],
    {
      cwd: ROOT,
      env: { ...process.env, DP_GATEWAY_PORT: String(PORT), SUPABASE_URL: `http://127.0.0.1:${PORT}`, DISPATCHER_SECRET: dispatcherSecret, TRUSTED_PROXY_HOPS: '1', LLM_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let log = ''
  gateway.stdout?.on('data', (d: Buffer) => (log += d.toString()))
  gateway.stderr?.on('data', (d: Buffer) => (log += d.toString()))
  for (let i = 0; i < 300 && !(await up(`http://127.0.0.1:${PORT}/health`)); i++) await new Promise((r) => setTimeout(r, 100))
  if (!(await up(`http://127.0.0.1:${PORT}/health`))) throw new Error(`test gateway did not start:\n${log}`)

  project.provide('api', {
    gateway: `http://127.0.0.1:${PORT}`,
    anonKey: keys.anonKey,
    serviceKey: keys.serviceRoleKey,
    dispatcherSecret,
    tlsKey: f('key.pem'),
    tlsCert: f('cert.pem'),
  })
  return () => {
    gateway?.kill()
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    api: { gateway: string; anonKey: string; serviceKey: string; dispatcherSecret: string; tlsKey: string; tlsCert: string }
  }
}
