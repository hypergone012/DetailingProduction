import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full rounded-lg border border-line bg-sunken px-3.5 py-3 text-base text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-subtle',
        'focus-visible:border-accent-text focus-visible:ring-3 focus-visible:ring-accent-subtle aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  )
}
