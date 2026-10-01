import { Switch as SwitchPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-line-strong bg-sunken p-0.5 outline-none transition-colors',
        'data-[state=checked]:border-transparent data-[state=checked]:bg-accent focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5.5 rounded-full bg-fg shadow transition-transform duration-200 data-[state=checked]:translate-x-5 data-[state=checked]:bg-accent-fg" />
    </SwitchPrimitive.Root>
  )
}
