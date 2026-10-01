import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'pressable inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset] hover:bg-accent-hover',
        secondary: 'bg-surface-2 text-fg border border-line hover:border-line-strong',
        outline: 'border border-line-strong bg-transparent text-fg hover:bg-surface-2',
        ghost: 'bg-transparent text-fg hover:bg-surface-2',
        subtle: 'bg-accent-subtle text-accent-text hover:brightness-110',
        danger: 'bg-danger-subtle text-danger border border-transparent hover:border-danger',
        link: 'h-auto px-0 text-accent-text underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 rounded-md px-3 text-sm [&_svg]:size-4',
        md: 'h-11 rounded-lg px-4 text-[15px] [&_svg]:size-[18px]',
        lg: 'h-13 rounded-xl px-5 text-base [&_svg]:size-5',
        icon: 'size-11 rounded-full [&_svg]:size-5',
        'icon-sm': 'size-9 rounded-full [&_svg]:size-4',
      },
      block: { true: 'w-full' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export function Button({ className, variant, size, block, asChild = false, loading = false, children, disabled, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  )
}

export { buttonVariants }
