import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Full-screen state (not found, offline, crash) that still looks like part of the product. */
export function StatusScreen({ icon, title, text, children, className }: { icon?: ReactNode; title: string; text?: string; children?: ReactNode; className?: string }) {
  return (
    <main className={cn('flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center safe-top safe-bottom', className)}>
      {icon && <div className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-fg-muted [&_svg]:size-7">{icon}</div>}
      <h1 className="text-2xl font-semibold">{title}</h1>
      {text && <p className="max-w-sm text-fg-muted">{text}</p>}
      {children && <div className="mt-2 flex flex-wrap justify-center gap-3">{children}</div>}
    </main>
  )
}
