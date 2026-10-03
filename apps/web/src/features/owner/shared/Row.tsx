import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CountUp } from '@/motion/Reveal'

/** Label/value line used in detail sheets. */
export function Row({ icon, label, children, className }: { icon?: ReactNode; label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-3 py-2', className)}>
      {icon && <span className="mt-0.5 text-fg-subtle [&_svg]:size-[18px]">{icon}</span>}
      <div className="grid min-w-0 flex-1 gap-0.5">
        {label && <span className="text-xs text-fg-subtle">{label}</span>}
        <div className="min-w-0 text-[15px]">{children}</div>
      </div>
    </div>
  )
}

/**
 * A figure tile. Numbers count up when they first appear; `count` + `format` do the same for a
 * formatted value (money): the final text is exactly `value`.
 */
export function Stat({
  label,
  value,
  hint,
  tone,
  count,
  format,
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'muted'
  count?: number | null
  format?: (n: number) => string
}) {
  const shown =
    typeof value === 'number' ? <CountUp value={value} /> : typeof count === 'number' && format && count > 0 ? <CountUp value={count} format={format} /> : value
  return (
    <div className="grid gap-1 rounded-2xl border border-line bg-surface p-4">
      <span className="text-xs text-fg-subtle">{label}</span>
      <span className={cn('text-xl font-semibold tabular', tone === 'muted' && 'text-fg-muted')}>{shown}</span>
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
    </div>
  )
}
