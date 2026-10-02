import { describe, expect, it } from 'vitest'
import { encodeConnectionPassword, explainDbError, functionEnv, normalizeInputs, pickJwtKeys, pickPagesDomain, planSecrets, toDotenv, type Generators } from './plan.ts'

const gen: Generators = {
  random: (n) => `r${n}`,
  vapid: async () => ({ publicKey: 'pub', privateKey: 'priv' }),
}

describe('deploy plan', () => {
  it('generates every secret on the first deploy', async () => {
    const { values, created } = await planSecrets({}, gen)
    expect(values).toEqual({ dp_access_token_secret: 'r48', dispatcher_secret: 'r32', dp_vapid_public_key: 'pub', dp_vapid_private_key: 'priv' })
    expect(created).toHaveLength(4)
  })

  it('never rotates existing secrets on a re-deploy; a broken VAPID pair is replaced as a pair', async () => {
    const kept = await planSecrets({ dp_access_token_secret: 'a', dispatcher_secret: 'd', dp_vapid_public_key: 'p', dp_vapid_private_key: 'k' }, gen)
    expect(kept.created).toEqual([])
    expect(kept.values.dp_access_token_secret).toBe('a')
    const half = await planSecrets({ dp_access_token_secret: 'a', dispatcher_secret: 'd', dp_vapid_public_key: 'p' }, gen)
    expect(half.created).toEqual(['dp_vapid_public_key', 'dp_vapid_private_key'])
    expect([half.values.dp_vapid_public_key, half.values.dp_vapid_private_key]).toEqual(['pub', 'priv'])
  })

  it('function env: exact origin for CORS, LLM only when a key is given', () => {
    const vault = { dp_access_token_secret: 'a', dispatcher_secret: 'd', dp_vapid_public_key: 'p', dp_vapid_private_key: 'k' }
    const env = functionEnv({ vault, appUrl: 'https://studio.pages.dev/' })
    expect(env).toMatchObject({ APP_URL: 'https://studio.pages.dev', ALLOWED_ORIGINS: 'https://studio.pages.dev', ACCESS_TOKEN_SECRET: 'a', DISPATCHER_SECRET: 'd', VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k' })
    expect(env).not.toHaveProperty('LLM_API_KEY')
    expect(functionEnv({ vault, appUrl: 'https://x.dev', llm: { apiKey: 'sk', model: 'm' } })).toMatchObject({ LLM_API_KEY: 'sk', LLM_MODEL: 'm' })
    expect(toDotenv({ A: '1', B: 'x=y' })).toBe('A=1\nB=x=y\n')
    expect(() => toDotenv({ A: 'a\nb' })).toThrow()
  })

  it('takes the JWT anon / service_role keys and explains how to enable them when missing', () => {
    const jwt = (s: string) => `h.${s}.sig`
    expect(
      pickJwtKeys([
        { name: 'anon', api_key: jwt('anon') },
        { name: 'service_role', api_key: jwt('svc') },
        { name: 'default', api_key: 'sb_publishable_x', type: 'publishable' },
      ]),
    ).toEqual({ anonKey: jwt('anon'), serviceRoleKey: jwt('svc') })
    expect(() => pickJwtKeys([{ name: 'default', api_key: 'sb_publishable_x' }])).toThrow(/Legacy API keys/)
  })

  it('reads the real pages.dev address of the project (Cloudflare may add a suffix)', () => {
    const list = [
      { 'Project Name': 'other', 'Project Domains': 'other.pages.dev' },
      { 'Project Name': 'detailing-studio', 'Project Domains': 'app.example.ru, detailing-studio-1x2.pages.dev' },
    ]
    expect(pickPagesDomain(list, 'detailing-studio')).toBe('detailing-studio-1x2.pages.dev')
    expect(() => pickPagesDomain(list, 'missing')).toThrow(/не найден/)
  })
})

describe('repository secrets as people paste them', () => {
  const ref = 'abcdefghijklmnopqrst'
  const acc = '0123456789abcdef0123456789abcdef'
  const good = {
    accessToken: `sbp_${'test'.repeat(10)}`, // not a real token's shape (push protection)
    projectRef: ref,
    databaseUrl: `postgresql://postgres.${ref}:Kq7mP2x9Lw4nZ8vB@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
    cfApiToken: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-Ab',
    cfAccountId: acc,
    demoPassword: 'demo-pass-2026',
    llmApiKey: '',
    pagesProject: 'detailing-studio',
  }

  it('accepts correct values as they are', () => {
    expect(normalizeInputs(good)).toEqual({ inputs: good, problems: [], warnings: [] })
  })

  it('repairs the usual copy-paste slips: whole dashboard addresses, spaces, line breaks, quotes', () => {
    const { inputs, problems } = normalizeInputs({
      ...good,
      cfAccountId: ` https://dash.cloudflare.com/${acc.toUpperCase()}/home \n`,
      projectRef: `https://supabase.com/dashboard/project/${ref}/settings/general`,
      databaseUrl: `"${good.databaseUrl}"\n`,
      cfApiToken: `${good.cfApiToken}\n`,
    })
    expect(problems).toEqual([])
    expect(inputs).toMatchObject({ cfAccountId: acc, projectRef: ref, databaseUrl: good.databaseUrl, cfApiToken: good.cfApiToken })
    expect(normalizeInputs({ ...good, projectRef: `https://${ref}.supabase.co` }).inputs.projectRef).toBe(ref)
  })

  it('explains what is wrong without printing the secret', () => {
    const cases: [Partial<typeof good>, RegExp][] = [
      [{ cfAccountId: 'me@example.com' }, /CLOUDFLARE_ACCOUNT_ID.*почта/],
      [{ cfAccountId: good.cfApiToken }, /CLOUDFLARE_ACCOUNT_ID.*API-токен/],
      [{ cfApiToken: acc }, /CLOUDFLARE_API_TOKEN.*Account ID/],
      [{ databaseUrl: good.databaseUrl.replace('Kq7mP2x9Lw4nZ8vB', '[YOUR-PASSWORD]') }, /\[YOUR-PASSWORD\]/],
      [{ databaseUrl: `postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres` }, /Direct connection/],
      [{ databaseUrl: good.databaseUrl.replace(':5432', ':6543') }, /Transaction pooler/],
      [{ databaseUrl: good.databaseUrl.replace(ref, 'zyxwvutsrqponmlkjihg') }, /другого проекта/],
      [{ accessToken: 'eyJhbGciOiJIUzI1NiJ9.x.y' }, /sbp_/],
      [{ projectRef: 'detailing' }, /20 строчных/],
      [{ demoPassword: '123' }, /не короче 8/],
      [{ pagesProject: 'My Studio' }, /строчная латиница/],
    ]
    for (const [patch, re] of cases) {
      const { problems } = normalizeInputs({ ...good, ...patch })
      expect(problems.join(' | '), JSON.stringify(Object.keys(patch))).toMatch(re)
      for (const value of Object.values(patch)) if (value.length > 12) expect(problems.join(' ')).not.toContain(value)
    }
  })

  it('reports every missing secret at once', () => {
    const { problems } = normalizeInputs({ pagesProject: 'detailing-studio' })
    expect(problems.filter((p) => p.startsWith('Не задан секрет'))).toHaveLength(6)
  })
})

describe('database connection errors', () => {
  const url = 'postgresql://postgres.abcdefghijklmnopqrst:S3cretPw9@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
  it('turns driver errors into plain advice and never repeats the password', () => {
    expect(explainDbError({ code: '28P01', message: 'password authentication failed for user "postgres"' }, url)).toMatch(/отклонила пароль.*Reset database password/)
    expect(explainDbError({ code: 'XX000', message: 'Tenant or user not found' }, url)).toMatch(/postgres\.<ваш ref>/)
    expect(explainDbError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND x' }, url)).toMatch(/не найден/)
    expect(explainDbError({ code: 'ENETUNREACH', message: 'connect ENETUNREACH 2a05::1:5432' }, url)).toMatch(/Direct connection.*Session pooler/)
    const other = explainDbError({ message: 'weird failure for S3cretPw9' }, url)
    expect(other).toContain('aws-0-eu-central-1.pooler.supabase.com:5432')
    expect(other).not.toContain('S3cretPw9')
  })

  it('an unfamiliar database host is a warning plus a connection probe, not a hard stop', () => {
    const r = normalizeInputs({
      accessToken: `sbp_${'test'.repeat(10)}`,
      projectRef: 'abcdefghijklmnopqrst',
      databaseUrl: 'postgresql://postgres.abcdefghijklmnopqrst:pw123456@eu-central-1.pooler.supabase.net:5432/postgres',
      cfApiToken: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-Ab',
      cfAccountId: '0123456789abcdef0123456789abcdef',
      demoPassword: 'demo-pass-2026',
      pagesProject: 'detailing-studio',
    })
    expect(r.problems).toEqual([])
    expect(r.warnings.join(' ')).toContain('eu-central-1.pooler.supabase.net:5432')
    expect(r.inputs.databaseUrl).toContain('pooler.supabase.net')
  })
})

describe('connection string with special characters in the password', () => {
  const base = (pw: string) => `postgresql://postgres.abcdefghijklmnopqrst:${pw}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
  it('finds the real host after the last @ and encodes the password', () => {
    for (const pw of ['Xx@9y/Zz', 'a#b?c:d', 'p@ss/w:rd#1', 'simpleOnly123']) {
      const fixed = encodeConnectionPassword(base(pw))
      const u = new URL(fixed)
      expect(u.hostname).toBe('aws-0-eu-central-1.pooler.supabase.com')
      expect(u.port).toBe('5432')
      expect(u.username).toBe('postgres.abcdefghijklmnopqrst')
      expect(decodeURIComponent(u.password)).toBe(pw)
    }
    expect(encodeConnectionPassword(base('already%40encoded'))).toBe(base('already%40encoded'))
  })

  it('normalizeInputs accepts such a string and passes the encoded one on', () => {
    const r = normalizeInputs({
      accessToken: `sbp_${'test'.repeat(10)}`,
      projectRef: 'abcdefghijklmnopqrst',
      databaseUrl: base('Xx@9y/Zz'),
      cfApiToken: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-Ab',
      cfAccountId: '0123456789abcdef0123456789abcdef',
      demoPassword: 'demo-pass-2026',
      pagesProject: 'detailing-studio',
    })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.inputs.databaseUrl).toBe(base(encodeURIComponent('Xx@9y/Zz')))
  })
})

describe('database password from its own secret', () => {
  const tpl = 'postgresql://postgres.abcdefghijklmnopqrst:[YOUR-PASSWORD]@aws-1-eu-central-1.pooler.supabase.com:5432/postgres'
  const others = {
    accessToken: `sbp_${'test'.repeat(10)}`,
    projectRef: 'abcdefghijklmnopqrst',
    cfApiToken: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-Ab',
    cfAccountId: '0123456789abcdef0123456789abcdef',
    demoPassword: 'demo-pass-2026',
    pagesProject: 'detailing-studio',
  }
  const pwOf = (url: string) => decodeURIComponent(new URL(url).password)

  it('fills [YOUR-PASSWORD] or replaces a wrong password in the string; special characters survive', () => {
    for (const databaseUrl of [tpl, tpl.replace('[YOUR-PASSWORD]', 'old@wrong/pw'), tpl.replace(':[YOUR-PASSWORD]', '')]) {
      const r = normalizeInputs({ ...others, databaseUrl, dbPassword: ' N3w@pass/w0rd#x ' })
      expect(r.problems).toEqual([])
      expect(new URL(r.inputs.databaseUrl).hostname).toBe('aws-1-eu-central-1.pooler.supabase.com')
      expect(pwOf(r.inputs.databaseUrl)).toBe('N3w@pass/w0rd#x')
    }
  })

  it('without the separate secret: [YOUR-PASSWORD] is explained, brackets around a password are removed', () => {
    expect(normalizeInputs({ ...others, databaseUrl: tpl }).problems.join(' ')).toMatch(/SUPABASE_DB_PASSWORD/)
    const r = normalizeInputs({ ...others, databaseUrl: tpl.replace('[YOUR-PASSWORD]', '[Kq7mP2x9]') })
    expect(r.problems).toEqual([])
    expect(pwOf(r.inputs.databaseUrl)).toBe('Kq7mP2x9')
    expect(r.warnings.join(' ')).toMatch(/квадратные скобки/)
  })

  it('wrong password advice points to SUPABASE_DB_PASSWORD', () => {
    expect(explainDbError({ code: '28P01', message: 'password authentication failed' }, tpl.replace('[YOUR-PASSWORD]', 'x'))).toMatch(/SUPABASE_DB_PASSWORD/)
  })
})
