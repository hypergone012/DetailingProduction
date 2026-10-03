/**
 * Keeps the design system's i18n off the critical path:
 *  - `intl-messageformat` (~120 KB) is replaced by src/lib/icu-lite.ts (same output for every
 *    catalog message, see icu-lite.test.ts);
 *  - the `en` and `ru-RU` catalogs (~200 KB of JSON with all 80 components' strings and their
 *    translator notes) are cut to the keys of the components this app imports.
 * The build fails if any key used by the bundled code is missing from the cut catalogs.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import type { Plugin } from 'vite'

const KEY = /@astryx\.[A-Za-z0-9_.-]+/g
const CATALOG = /@astryxdesign[+/]core.*\/locales\/(en|ru-RU)\.json$/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

/** Keys reachable from the app's `@astryxdesign/core/<entry>` imports, following the package's own imports. */
function usedKeys(appSrc: string): Set<string> {
  const require = createRequire(join(appSrc, 'index.ts'))
  // The package exports no ./package.json: walk up from a public entry to its root.
  let pkgDir = dirname(require.resolve('@astryxdesign/core/i18n'))
  while (!existsSync(join(pkgDir, 'package.json')) || !readFileSync(join(pkgDir, 'package.json'), 'utf8').includes('"name": "@astryxdesign/core"')) pkgDir = dirname(pkgDir)
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { exports: Record<string, { default?: string } | string> }
  const entryOf = (sub: string) => {
    const e = pkg.exports[sub === '' ? '.' : `./${sub}`]
    const target = typeof e === 'string' ? e : e?.default
    return target && target.endsWith('.js') ? resolve(pkgDir, target) : null
  }
  const queue: string[] = []
  for (const file of sourceFiles(appSrc)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/from\s*['"]@astryxdesign\/core(?:\/([^'"]+))?['"]/g)) {
      const entry = entryOf(m[1] ?? '')
      if (entry) queue.push(entry)
    }
  }
  const seen = new Set<string>()
  const keys = new Set<string>()
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    // Doc comments show usage examples (`import … from '@astryxdesign/core'`): not imports.
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const k of code.match(KEY) ?? []) keys.add(k)
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1]!
      if (spec.startsWith('.') && spec.endsWith('.js')) queue.push(resolve(dirname(file), spec))
      else if (spec.startsWith('@astryxdesign/core')) {
        const entry = entryOf(spec.slice('@astryxdesign/core'.length).replace(/^\//, ''))
        if (entry) queue.push(entry)
      }
    }
  }
  return keys
}

export function astryxSlim(appSrc: string): Plugin {
  let keys: Set<string> | null = null
  const used = () => (keys ??= usedKeys(appSrc))
  return {
    name: 'dp-astryx-slim',
    enforce: 'pre',
    resolveId(source) {
      if (source === 'intl-messageformat') return join(appSrc, 'lib/icu-lite.ts')
      return null
    },
    load(id) {
      if (!CATALOG.test(id)) return null
      const catalog = JSON.parse(readFileSync(id, 'utf8')) as Record<string, { defaultMessage: string | null }>
      const slim = Object.fromEntries(Object.entries(catalog).flatMap(([k, v]) => (used().has(k) ? [[k, { defaultMessage: v.defaultMessage }]] : [])))
      return JSON.stringify(slim)
    },
    generateBundle(_options, bundle) {
      const missing = new Set<string>()
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const k of chunk.code.match(KEY) ?? []) if (!used().has(k)) missing.add(k)
      }
      if (missing.size) this.error(`astryx-slim: keys used by the bundle but cut from the catalogs: ${[...missing].join(', ')}`)
    },
  }
}
