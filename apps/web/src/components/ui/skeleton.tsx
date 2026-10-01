import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Loading placeholder shaped like the content it replaces (no fake delays anywhere). */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden className={cn('skeleton rounded-lg', className)} {...props} />
}
