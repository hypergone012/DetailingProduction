import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Lite from './icu-lite'

// The real library, from where the design system resolves it.
const fromAstryx = createRequire(createRequire(import.meta.url).resolve('@astryxdesign/core/i18n'))
const Real = fromAstryx('intl-messageformat').default as new (m: string, l: string) => { format: (v: Record<string, unknown>) => unknown }
const locales = join(dirname(createRequire(import.meta.url).resolve('@astryxdesign/core/i18n')), '../../locales')
const catalog = (name: string) =>
  Object.entries(JSON.parse(readFileSync(join(locales, `${name}.json`), 'utf8')) as Record<string, { defaultMessage: string | null }>).flatMap(([key, v]) =>
    v.defaultMessage?.includes('{') ? [[key, v.defaultMessage] as const] : [],
  )

/** Every argument of a message and how it is used. */
function args(message: string) {
  const out = new Map<string, { kind: 'plain' | 'number' | 'select'; options: string[] }>()
  for (const m of message.matchAll(/\{\s*(\w+)\s*(?:,\s*(\w+))?/g)) {
    const [, name, type] = m
    if (!name || out.has(name) && out.get(name)!.kind !== 'plain') continue
    if (type === 'select') {
      const body = message.slice(m.index! + m[0].length)
      out.set(name, { kind: 'select', options: [...body.matchAll(/(\w+)\s*\{/g)].map((x) => x[1]!).slice(0, 4) })
    } else out.set(name, { kind: type === 'number' || type === 'plural' ? 'number' : 'plain', options: [] })
  }
  return out
}

describe('icu-lite matches intl-messageformat', () => {
  for (const locale of ['ru-RU', 'en']) {
    const messages = catalog(locale)
    it(`formats all ${messages.length} parametrised ${locale} messages identically`, () => {
      let checked = 0
      for (const [key, message] of messages) {
        const spec = args(message)
        const selects = [...spec].filter(([, s]) => s.kind === 'select')
        const choices = selects.length ? selects[0]![1].options.concat('zzz') : ['']
        for (const n of [0, 1, 2, 3, 4, 5, 11, 12, 21, 22, 25, 101, 1000, 1234567]) {
          for (const choice of choices) {
            const values: Record<string, unknown> = {}
            for (const [name, s] of spec) values[name] = s.kind === 'number' ? n : s.kind === 'select' ? choice : `«${name}»`
            const real = String(new Real(message, locale).format(values))
            expect(new Lite(message, locale).format(values), `${key} ${JSON.stringify(values)}`).toBe(real)
            checked++
          }
        }
      }
      expect(checked).toBeGreaterThan(500)
    })
  }
})
