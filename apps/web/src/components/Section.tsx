import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ease } from '@/motion/tokens'

/** The section rises into place the first time it scrolls into view (same box, no layout change). */
export function Section({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <m.section
      className={cn('grid gap-3', className)}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.5, ease: ease.out }}
    >
      {(title || action) && (
        <div className="flex items-end justify-between gap-3 px-1">
          {title && <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </m.section>
  )
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-line bg-surface shadow-card', className)} {...rest}>
      {children}
    </div>
  )
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-fg-muted [&_svg]:size-6">{icon}</div>
      <p className="font-semibold">{title}</p>
      {text && <p className="max-w-xs text-sm text-fg-muted">{text}</p>}
      {action}
    </div>
  )
}
