/**
 * The design system ships one stylesheet with the atomic StyleX rules of all its ~80
 * components (~170 KB); this app renders about ten of them. StyleX class names (`x` + hash)
 * reach the DOM only from string literals in the bundled JavaScript, so a rule whose selector
 * is made of StyleX classes, none of which appears in any output chunk, can never match.
 * Those rules are cut from the CSS; every other byte of the stylesheet is kept as is.
 */
import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'

const STYLEX_CLASS = /^x[a-z0-9]{4,10}$/
const NESTED_AT = /^@(media|supports|layer|container|scope|starting-style)\b/i

/** Index just past the block that opens at `open` (`{`), skipping strings and comments. */
function blockEnd(css: string, open: number): number {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    const c = css[i]
    if (c === '"' || c === "'") {
      for (i++; i < css.length && css[i] !== c; i++) if (css[i] === '\\') i++
    } else if (c === '/' && css[i + 1] === '*') {
      i = css.indexOf('*/', i + 2) + 1
      if (i === 0) return css.length
    } else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
  }
  return css.length
}

/** True when every selector in the list is built only from StyleX classes and none is used. */
function unusedStylex(selector: string, used: Set<string>): boolean {
  const parts = selector.split(',')
  return parts.every((part) => {
    // Pseudo-classes/elements and combinators are fine; element names, ids, attributes, :root are not.
    const stripped = part.replace(/::?[a-z-]+(\([^)]*\))?/gi, '').replace(/[\s>+~]+/g, ' ').trim()
    if (!stripped) return false
    const tokens = stripped.split(' ').flatMap((t) => t.split(/(?=\.)/))
    return tokens.every((t) => t.startsWith('.') && STYLEX_CLASS.test(t.slice(1)) && !used.has(t.slice(1)))
  })
}

export function purgeCss(css: string, used: Set<string>): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    const semi = css.indexOf(';', i)
    if (open === -1 || (semi !== -1 && semi < open && css.slice(i, semi).trimStart().startsWith('@'))) {
      // statement at-rule (@import, @layer a, b;) or trailing text
      const end = open === -1 ? css.length : semi + 1
      out += css.slice(i, end)
      i = end
      continue
    }
    const prelude = css.slice(i, open)
    const end = blockEnd(css, open)
    const head = prelude.trim()
    if (NESTED_AT.test(head)) {
      const inner = purgeCss(css.slice(open + 1, end - 1), used)
      if (inner.trim()) out += `${prelude}{${inner}}`
    } else if (head.startsWith('@') || !unusedStylex(head, used)) {
      out += css.slice(i, end)
    }
    i = end
  }
  return out
}

export function purgeStylex(): Plugin {
  return {
    name: 'dp-purge-stylex',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const used = new Set<string>()
        for (const file of Object.values(bundle)) {
          if (file.type === 'chunk') for (const m of file.code.matchAll(/x[a-z0-9]{4,10}/g)) used.add(m[0])
        }
        const renamed = new Map<string, string>()
        for (const file of Object.values(bundle)) {
          if (file.type !== 'asset' || !file.fileName.endsWith('.css') || typeof file.source !== 'string') continue
          const before = file.source.length
          const source = purgeCss(file.source, used)
          // The name's hash was taken before the cut; /assets/ is cached as immutable, so the
          // name must follow the final content (a later build may keep different rules).
          const hash = createHash('sha256').update(source).digest('base64url').replace(/[-_]/g, '').slice(0, 8)
          const name = file.fileName.replace(/-[A-Za-z0-9_-]{8}\.css$/, `-${hash}.css`)
          if (name === file.fileName) file.source = source
          else {
            renamed.set(file.fileName, name)
            Reflect.deleteProperty(bundle, file.fileName)
            this.emitFile({ type: 'asset', fileName: name, source })
          }
          this.info(`${name}: ${(before / 1024).toFixed(0)} KB → ${(source.length / 1024).toFixed(0)} KB (unused design-system rules)`)
        }
        // Point the page and the chunks' preload lists at the new names.
        for (const file of Object.values(bundle)) {
          for (const [from, to] of renamed) {
            const base = from.split('/').pop()!
            const next = to.split('/').pop()!
            if (file.type === 'chunk') {
              file.code = file.code.replaceAll(base, next)
              const css = file.viteMetadata?.importedCss
              if (css?.has(from)) {
                css.delete(from)
                css.add(to)
              }
            } else if (typeof file.source === 'string') file.source = file.source.replaceAll(base, next)
          }
        }
      },
    },
  }
}
