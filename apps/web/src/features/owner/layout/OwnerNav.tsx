import { m } from 'motion/react'
import { NavLink, useLocation } from 'react-router'
import { cn } from '@/lib/utils'
import { spring } from '@/motion/tokens'
import { useOwner } from '../data'
import { OWNER_TABS, ownerTabIndex } from './nav'

/** Bottom bar on phones, side rail from md up. Same five destinations. */
export function OwnerNav() {
  const { slug } = useOwner()
  const { pathname } = useLocation()
  const active = ownerTabIndex(pathname, slug)
  return (
    <nav
      aria-label="Разделы кабинета"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg-elevated/95 backdrop-blur-sm md:inset-y-0 md:right-auto md:w-[88px] md:border-t-0 md:border-r md:pt-[calc(var(--dp-safe-top)+12px)]"
      style={{ paddingBottom: 'var(--dp-safe-bottom)' }}
    >
      <ul className="mx-auto grid h-[var(--dp-nav-height)] max-w-xl grid-cols-5 px-1 md:h-auto md:grid-cols-1 md:gap-1 md:px-2">
        {OWNER_TABS.map((tab, i) => {
          const Icon = tab.icon
          const isActive = i === active
          return (
            <li key={tab.segment} className="flex md:h-16">
              <NavLink
                to={`/s/${slug}/owner${tab.segment ? `/${tab.segment}` : ''}`}
                end={!tab.segment}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'pressable relative flex flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  isActive ? 'text-fg' : 'text-fg-subtle',
                )}
              >
                {isActive && <m.span layoutId="owner-nav-pill" className="absolute inset-x-2.5 top-1.5 h-8 rounded-full bg-accent-subtle md:inset-x-3 md:top-2" transition={spring} aria-hidden />}
                <Icon className={cn('relative size-[22px] transition-colors', isActive && 'text-accent-text')} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
                <span className="relative">{tab.label}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
