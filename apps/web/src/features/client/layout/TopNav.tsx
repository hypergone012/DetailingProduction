import { CalendarPlus } from 'lucide-react'
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
  return (
    <nav aria-label="Разделы" className="fixed inset-x-0 top-0 z-40 hidden border-b border-line bg-bg-elevated/95 backdrop-blur-sm md:block">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-6 px-6 lg:h-[72px] lg:max-w-[1440px] lg:px-8">
        <Link to={`/s/${slug}`} className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {logo?.url && <img src={logo.url} alt="" className="size-9 shrink-0 rounded-xl border border-line bg-surface object-contain p-1 lg:size-11" />}
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
                    'flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none transition-colors hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-focus lg:h-11 lg:px-4 lg:text-[15px]',
                    i === active ? 'bg-accent-subtle text-accent-text' : 'text-fg-muted',
                  )}
                >
                  <Icon className="size-[18px]" aria-hidden />
                  {tab.label}
                </NavLink>
              </li>
            )
          })}
        </ul>
        <Button onClick={() => flow.start()} className="lg:h-12 lg:px-5 lg:text-base">
          <CalendarPlus /> Записаться
        </Button>
      </div>
    </nav>
  )
}
