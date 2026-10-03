import { ChevronLeft } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Sticky screen header. "Back" follows browser history when this screen was reached inside
 * the app, and goes to the logical parent otherwise (deep link), so Back is predictable.
 */
export function ScreenHeader({
  title,
  parent,
  actions,
  large = false,
  wide = false,
  site = false,
  subtitle,
}: {
  title: string
  parent?: string
  actions?: ReactNode
  large?: boolean
  /** Full content width (owner cabinet) instead of the phone column. */
  wide?: boolean
  /** Client site: from `lg` up a page headline across the site width (not sticky; the site header stays on top). */
  site?: boolean
  /** Shown under the headline on the desktop site only. */
  subtitle?: string
}) {
  const navigate = useNavigate()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else if (parent) navigate(parent, { replace: true })
  }
  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b bg-bg/95 transition-colors md:backdrop-blur-sm',
        scrolled ? 'border-line' : 'border-transparent',
        site && 'lg:static lg:border-transparent lg:bg-transparent lg:backdrop-blur-none',
      )}
      style={{ paddingTop: 'var(--dp-safe-top)', top: 'var(--dp-header-offset, 0px)' }}
    >
      <div
        className={cn(
          'mx-auto flex h-14 items-center gap-1 px-2',
          wide ? 'max-w-6xl' : 'max-w-xl md:max-w-2xl',
          site && 'lg:h-auto lg:max-w-[1440px] lg:items-end lg:gap-4 lg:px-8 lg:pt-10 lg:pb-8',
        )}
      >
        {parent ? (
          <Button variant="ghost" size="icon" onClick={back} aria-label="Назад" className={cn(site && 'lg:mb-1 lg:border lg:border-line')}>
            <ChevronLeft />
          </Button>
        ) : (
          <span className={cn('w-2', site && 'lg:hidden')} />
        )}
        <div className="grid min-w-0 flex-1 gap-2">
          <h1
            className={cn(
              'min-w-0 truncate font-semibold',
              large ? 'text-xl' : 'text-[17px]',
              !parent && 'pl-2',
              site && 'lg:pl-0 lg:font-bold lg:tracking-tight lg:whitespace-normal',
              site && (large ? 'lg:text-gradient lg:text-[44px] lg:leading-tight' : 'lg:text-gradient lg:text-[34px] lg:leading-tight'),
            )}
          >
            {title}
          </h1>
          {site && subtitle && <p className="hidden text-lg text-fg-muted lg:block">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1 lg:gap-3">{actions}</div>
      </div>
    </header>
  )
}
