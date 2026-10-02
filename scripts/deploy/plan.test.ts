import { describe, expect, it } from 'vitest'
import { functionEnv, pickJwtKeys, pickPagesDomain, planSecrets, toDotenv, type Generators } from './plan.ts'

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
