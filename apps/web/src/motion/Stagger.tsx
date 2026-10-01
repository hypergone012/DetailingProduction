import { m } from 'motion/react'
import type { ComponentProps, ReactNode } from 'react'
import { listContainer, listItem } from './tokens'

/** List entrance: items rise in a short cascade once, when the list first appears. */
export function Stagger({ children, className, as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'ul' | 'ol' }) {
  const Comp = as === 'ul' ? m.ul : as === 'ol' ? m.ol : m.div
  return (
    <Comp className={className} variants={listContainer} initial="hidden" animate="show">
      {children}
    </Comp>
  )
}

export function StaggerItem({ children, className, as = 'div', ...rest }: { children: ReactNode; className?: string; as?: 'div' | 'li' } & Omit<ComponentProps<typeof m.div>, 'children'>) {
  const Comp = as === 'li' ? m.li : m.div
  return (
    <Comp className={className} variants={listItem} {...(rest as object)}>
      {children}
    </Comp>
  )
}
