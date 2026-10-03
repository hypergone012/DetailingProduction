import { Switch as SwitchPrimitive } from 'radix-ui'
import { useRef, useState, type ComponentProps } from 'react'
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

/**
 * A switch that saves to the server: it moves at once and stays there while the change is
 * saved (and the cabinet's data refreshed), then follows the saved value — so it springs back
 * if saving failed (the caller shows the error). Clicks are saved in order.
 */
export function SavingSwitch({
  checked,
  onSave,
  ...props
}: Omit<ComponentProps<typeof SwitchPrimitive.Root>, 'checked' | 'onCheckedChange'> & { checked: boolean; onSave: (next: boolean) => Promise<unknown> }) {
  const [shown, setShown] = useState<boolean | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const latest = useRef(0)
  return (
    <Switch
      {...props}
      checked={shown ?? checked}
      onCheckedChange={(next) => {
        const call = ++latest.current
        setShown(next)
        queue.current = queue.current
          .then(() => onSave(next))
          .catch(() => undefined)
          .finally(() => {
            if (call === latest.current) setShown(null)
          })
      }}
    />
  )
}
