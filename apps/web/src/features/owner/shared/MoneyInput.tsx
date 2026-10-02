import { useState, type ComponentProps } from 'react'
import { Input } from '@/components/ui/input'

const parse = (text: string): number | null => {
  const n = Number(text.replace(',', '.').replace(/\s/g, ''))
  return text.trim() && Number.isFinite(n) ? Math.round(n * 100) : null
}
const format = (cents: number | null) => (cents === null ? '' : String(cents / 100))

/** Amount typed in currency units (rubles), stored in cents. Empty -> null. */
export function MoneyInput({ cents, onCents, ...rest }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & { cents: number | null; onCents: (v: number | null) => void }) {
  const [text, setText] = useState(() => format(cents))
  const [seen, setSeen] = useState(cents)
  // A new value from outside (e.g. "pay the balance") replaces what is shown; typing does not.
  if (cents !== seen) {
    setSeen(cents)
    if (parse(text) !== cents) setText(format(cents))
  }
  return (
    <Input
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d.,\s]/g, '')
        setText(v)
        const c = parse(v)
        setSeen(c)
        onCents(c)
      }}
      {...rest}
    />
  )
}
