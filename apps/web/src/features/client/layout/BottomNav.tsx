import { m } from 'motion/react'
import { NavLink, useLocation } from 'react-router'
import { cn } from '@/lib/utils'
import { spring } from '@/motion/tokens'
import { useTenant } from '@/tenant/TenantProvider'
import { TABS, tabIndexOf } from './tabs'

export function BottomNav() {
  const { slug } = useTenant()
  const { pathname } = useLocation()
  const rel = pathname.slice(`/s/${slug}`.length).split('/').filter(Boolean)
  const active = tabIndexOf(rel[0])
  return (
    <nav
      aria-label="Разделы"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg-elevated/95 backdrop-blur-sm md:hidden"
      style={{ paddingBottom: 'var(--dp-safe-bottom)' }}
    >
      <ul className="mx-auto grid h-[var(--dp-nav-height)] max-w-xl grid-cols-5 px-1">
        {TABS.map((tab, i) => {
          const Icon = tab.icon
          const isActive = i === active
          return (
            <li key={tab.key} className="flex">
              <NavLink
                to={tab.segment ? `/s/${slug}/${tab.segment}` : `/s/${slug}`}
                end={!tab.segment}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'pressable relative flex flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  isActive ? 'text-fg' : 'text-fg-subtle',
                )}
              >
                {isActive && <m.span layoutId="bottom-nav-pill" className="absolute inset-x-2.5 top-1.5 h-8 rounded-full bg-accent-subtle" transition={spring} aria-hidden />}
                <m.span
                  className="relative"
                  key={isActive ? 'on' : 'off'}
                  initial={isActive ? { scale: 0.7, y: 2 } : false}
                  animate={{ scale: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 18 }}
                >
                  <Icon className={cn('size-[22px] transition-colors', isActive && 'text-accent-text')} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
                </m.span>
                <span className="relative">{tab.label}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
