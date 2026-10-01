import { m } from 'motion/react'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { useId, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { spring } from '@/motion/tokens'

/**
 * Radix Tabs (keyboard navigation, roving focus, aria) with a shared animated indicator.
 * `value` must be controlled so the indicator knows the active tab.
 */
export function Tabs(props: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('relative inline-flex h-11 items-center gap-1 rounded-xl border border-line bg-sunken p-1', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, children, active, indicatorId, ...props }: ComponentProps<typeof TabsPrimitive.Trigger> & { active: boolean; indicatorId: string }) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'relative z-0 inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fg-muted outline-none transition-colors',
        'data-[state=active]:text-fg focus-visible:ring-2 focus-visible:ring-focus',
        className,
      )}
      {...props}
    >
      {active && <m.span layoutId={indicatorId} className="absolute inset-0 -z-10 rounded-lg bg-surface-2 shadow-card" transition={spring} />}
      {children}
    </TabsPrimitive.Trigger>
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('outline-none', className)} {...props} />
}

export function useIndicatorId(): string {
  return `tabs-${useId()}`
}
