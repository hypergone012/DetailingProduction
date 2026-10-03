import { jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'
import { readConfig, renderServer, envFile, selfSigned } from './render'
import { parseEnvFile, planServerSecrets, SECRET_KEYS } from './secrets-plan'

describe('server secrets', () => {
  it('generates every secret once, with API keys signed by the JWT secret', async () => {
    const { values, created } = await planServerSecrets({})
    expect(created.sort()).toEqual([...SECRET_KEYS].sort())
    const secret = new TextEncoder().encode(values.DP_JWT_SECRET)
    expect((await jwtVerify(values.DP_ANON_KEY, secret)).payload.role).toBe('anon')
    expect((await jwtVerify(values.DP_SERVICE_ROLE_KEY, secret)).payload.role).toBe('service_role')
    expect(values.ACCESS_TOKEN_SECRET.length).toBeGreaterThanOrEqual(32)
    // VAPID: an uncompressed P-256 point (65 bytes) and a 32-byte scalar, base64url.
    expect(Buffer.from(values.VAPID_PUBLIC_KEY, 'base64url')).toHaveLength(65)
    expect(Buffer.from(values.VAPID_PRIVATE_KEY, 'base64url')).toHaveLength(32)
    for (const v of Object.values(values)) expect(v).toMatch(/^[A-Za-z0-9_.-]+$/)
  })

  it('never replaces an existing secret (booking links and push depend on them)', async () => {
    const first = (await planServerSecrets({})).values
    const again = await planServerSecrets(first)
    expect(again.created).toEqual([])
    expect(again.values).toEqual(first)
    // Secrets moved from the hosted project are kept as they are.
    const moved = await planServerSecrets({ ACCESS_TOKEN_SECRET: 'x'.repeat(64), VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' })
    expect(moved.values.ACCESS_TOKEN_SECRET).toBe('x'.repeat(64))
    expect(moved.values.VAPID_PUBLIC_KEY).toBe('pub')
    expect(moved.created).not.toContain('ACCESS_TOKEN_SECRET')
  })

  it('parses env files', () => {
    expect(parseEnvFile('# c\nA=1\n\nB = x=y \n')).toEqual({ A: '1', B: 'x=y' })
  })
})

describe('server config', () => {
  it('requires a real host name', () => {
    expect(() => readConfig({})).toThrow(/DP_DOMAIN/)
    expect(() => readConfig({ DP_DOMAIN: 'https://app.example.ru' })).toThrow(/DP_DOMAIN/)
    expect(() => readConfig({ DP_DOMAIN: 'app.example.ru {\n}' })).toThrow(/DP_DOMAIN/)
    expect(readConfig({ DP_DOMAIN: 'App.Example.RU' }).domain).toBe('app.example.ru')
    expect(() => readConfig({ DP_DOMAIN: 'a.ru', DP_ACME_EMAIL: 'x }' })).toThrow(/e-mail/)
    expect(() => readConfig({ DP_DOMAIN: 'a.ru', SMTP_HOST: 'smtp.a.ru' })).toThrow(/SMTP_USER/)
  })

  it('renders one origin: public URLs on the domain, functions call the API inside the server', async () => {
    const { values } = await planServerSecrets({})
    const files = renderServer(values, readConfig({ DP_DOMAIN: 'app.example.ru', LLM_API_KEY: 'k"\\' }))
    const gw = parseEnvFile(files['gateway.env']!)
    expect(gw.APP_URL).toBe('"https://app.example.ru"')
    expect(gw.ALLOWED_ORIGINS).toBe('"https://app.example.ru"')
    expect(gw.PUBLIC_STORAGE_URL).toBe('"https://app.example.ru"')
    expect(gw.SUPABASE_URL).toBe('"http://127.0.0.1:54321"')
    expect(gw.LLM_API_KEY).toBe('"k\\"\\\\"')
    const auth = parseEnvFile(files['auth.env']!)
    expect(auth.GOTRUE_SITE_URL).toBe('"https://app.example.ru"')
    expect(auth.GOTRUE_DISABLE_SIGNUP).toBe('"true"')
    expect(auth.GOTRUE_JWT_ISSUER).toBe('"https://app.example.ru/auth/v1"')
    // Every service listens on the loopback interface only.
    for (const f of ['auth.env', 'rest.env', 'storage.env', 'gateway.env']) expect(files[f]).not.toMatch(/0\.0\.0\.0/)
    expect(files.Caddyfile).toContain('app.example.ru {')
    expect(files.Caddyfile).toContain('reverse_proxy 127.0.0.1:54321')
    expect(files.Caddyfile).not.toContain('tls internal')
  })

  it('uses a self-signed certificate for localhost and IPs only', async () => {
    const { values } = await planServerSecrets({})
    expect(renderServer(values, readConfig({ DP_DOMAIN: 'localhost' })).Caddyfile).toContain('tls internal')
    expect(selfSigned('10.0.0.1')).toBe(true)
    expect(selfSigned('app.example.ru')).toBe(false)
  })

  it('writes systemd env files that cannot be broken by a value', () => {
    expect(envFile({ A: 'x y', B: 'q"\\' })).toBe('A="x y"\nB="q\\"\\\\"\n')
    expect(() => envFile({ A: 'a\nB=b' })).toThrow(/multi-line/)
    expect(() => envFile({ 'a b': 'x' })).toThrow(/name/)
  })
})
