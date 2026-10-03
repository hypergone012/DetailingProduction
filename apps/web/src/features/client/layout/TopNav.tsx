import { CalendarPlus } from 'lucide-react'
import { m } from 'motion/react'
import { useEffect, useState } from 'react'
import { spring } from '@/motion/tokens'
import { Link, NavLink, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTenant } from '@/tenant/TenantProvider'
import { useBookingFlow } from '../booking/flow'
import { TABS, tabIndexOf } from './tabs'

/** Desktop and tablet (md+): the same sections as the phone tab bar, as a site header. */
export function TopNav() {
  const { slug, data, mediaByKey, mediaFor } = useTenant()
  const flow = useBookingFlow()
  const { pathname } = useLocation()
  const active = tabIndexOf(pathname.slice(`/s/${slug}`.length).split('/').filter(Boolean)[0])
  const logo = mediaByKey(data.branding.logoKey) ?? mediaFor('logo')[0]
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  return (
    <nav
      aria-label="Разделы"
      className={cn(
        'fixed inset-x-0 top-0 z-40 hidden border-b backdrop-blur-xl transition-[background-color,box-shadow,border-color] duration-500 md:block',
        scrolled ? 'border-line bg-bg-elevated/90 shadow-[0_12px_40px_-24px_var(--dp-shadow)]' : 'border-transparent bg-bg-elevated/70',
      )}
    >
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-6 px-6 lg:h-[72px] lg:max-w-[1440px] lg:px-8">
        <Link to={`/s/${slug}`} className="group flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {logo?.url && (
            <img
              src={logo.url}
              alt=""
              className="size-9 shrink-0 rounded-xl border border-line bg-surface object-contain p-1 transition-transform duration-500 group-hover:rotate-[-6deg] group-hover:scale-105 lg:size-11"
            />
          )}
          <span className={cn('truncate font-semibold lg:text-xl lg:font-bold lg:tracking-tight', logo?.url && 'sr-only lg:not-sr-only')}>{data.tenant.name}</span>
        </Link>
        <ul className="ml-auto flex items-center gap-1">
          {TABS.map((tab, i) => {
            const Icon = tab.icon
            return (
              <li key={tab.key}>
                <NavLink
                  to={tab.segment ? `/s/${slug}/${tab.segment}` : `/s/${slug}`}
                  end={!tab.segment}
                  aria-current={i === active ? 'page' : undefined}
                  className={cn(
                    'relative flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-focus lg:h-11 lg:px-4 lg:text-[15px]',
                    i === active ? 'text-accent-text' : 'text-fg-muted',
                  )}
                >
                  {i === active && <m.span layoutId="top-nav-pill" className="absolute inset-0 rounded-lg bg-accent-subtle" transition={spring} aria-hidden />}
                  <Icon className="relative size-[18px]" aria-hidden />
                  <span className="relative">{tab.label}</span>
                </NavLink>
              </li>
            )
          })}
        </ul>
        <Button onClick={() => flow.start()} className="sheen lg:h-12 lg:px-5 lg:text-base">
          <CalendarPlus /> Записаться
        </Button>
      </div>
    </nav>
  )
}
