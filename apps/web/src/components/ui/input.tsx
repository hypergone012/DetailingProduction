import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-12 w-full min-w-0 rounded-lg border border-line bg-sunken px-3.5 text-base text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-subtle',
        'focus-visible:border-accent-text focus-visible:ring-3 focus-visible:ring-accent-subtle',
        'aria-invalid:border-danger aria-invalid:ring-danger-subtle disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
