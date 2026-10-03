/**
 * Drop-in for `intl-messageformat` (aliased in vite.config.ts), which the design system uses to
 * fill its few parametrised strings. The full library is ~120 KB of parser on every page; its
 * catalogs only need simple arguments, `number`, `plural` (with `#` and `=N`) and `select`,
 * which is all this implements (no apostrophe quoting: the catalogs use none).
 * `icu-lite.test.ts` checks it against the real library on every catalog message.
 */

type Values = Record<string, unknown>
type Node = string | { arg: string; type?: 'number'; options?: undefined } | { arg: string; type: 'plural' | 'select'; options: Record<string, Node[]>; offset: number }

function parse(src: string): Node[] {
  let i = 0
  const fail = (what: string) => new Error(`icu-lite: ${what} at ${i} in "${src}"`)
  const space = () => {
    while (i < src.length && /\s/.test(src[i]!)) i++
  }
  const word = () => {
    space()
    const start = i
    while (i < src.length && !/[\s,{}]/.test(src[i]!)) i++
    return src.slice(start, i)
  }
  function message(inPlural: boolean): Node[] {
    const out: Node[] = []
    let text = ''
    const flush = () => {
      if (text) out.push(text)
      text = ''
    }
    while (i < src.length && src[i] !== '}') {
      const c = src[i]!
      if (c === '{') {
        flush()
        out.push(argument())
      } else if (c === '#' && inPlural) {
        flush()
        out.push({ arg: '#' })
        i++
      } else {
        text += c
        i++
      }
    }
    if (text) out.push(text)
    return out
  }
  function argument(): Node {
    i++ // {
    const arg = word()
    space()
    if (src[i] === '}') {
      i++
      return { arg }
    }
    if (src[i] !== ',') throw fail('expected ,')
    i++
    const type = word()
    space()
    if (type === 'number') {
      if (src[i] !== '}') throw fail('number styles are not supported')
      i++
      return { arg, type }
    }
    if (type !== 'plural' && type !== 'select') throw fail(`unsupported type ${type}`)
    if (src[i] !== ',') throw fail('expected ,')
    i++
    const options: Record<string, Node[]> = {}
    let offset = 0
    for (;;) {
      space()
      if (src[i] === '}') {
        i++
        break
      }
      const key = word()
      if (key.startsWith('offset:')) {
        offset = Number(key.slice(7))
        continue
      }
      space()
      if (src[i] !== '{') throw fail('expected {')
      i++
      options[key] = message(type === 'plural')
      if (src[i] !== '}') throw fail('expected }')
      i++
    }
    if (!options.other) throw fail('missing other')
    return { arg, type, options, offset }
  }
  const nodes = message(false)
  if (i !== src.length) throw fail('unexpected }')
  return nodes
}

export default class IntlMessageFormat {
  private readonly nodes: Node[]
  private readonly locale: string
  constructor(message: string, locale?: string | string[]) {
    this.nodes = parse(message)
    this.locale = (Array.isArray(locale) ? locale[0] : locale) ?? 'en'
  }

  format(values: Values = {}): string {
    return this.render(this.nodes, values, null)
  }

  private number(n: unknown) {
    return new Intl.NumberFormat(this.locale).format(Number(n))
  }

  private render(nodes: Node[], values: Values, pluralValue: number | null): string {
    let out = ''
    for (const node of nodes) {
      if (typeof node === 'string') {
        out += node
        continue
      }
      if (node.arg === '#') {
        out += pluralValue === null ? '#' : this.number(pluralValue)
        continue
      }
      const v = values[node.arg]
      if (node.type === 'number') out += this.number(v)
      else if (node.type === 'plural') {
        const n = Number(v) - node.offset
        const exact = node.options[`=${Number(v)}`]
        const branch = exact ?? node.options[new Intl.PluralRules(this.locale).select(n)] ?? node.options.other!
        out += this.render(branch, values, n)
      } else if (node.type === 'select') out += this.render(node.options[String(v)] ?? node.options.other!, values, pluralValue)
      else out += v === undefined ? '' : String(v)
    }
    return out
  }
}
