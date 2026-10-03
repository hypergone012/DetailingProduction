import { MapPin, Phone } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { useMotionPreference } from '@/theme/ThemeProvider'
import { Card } from '@/components/Section'
import { phonePretty } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Reveal } from '@/motion/Reveal'
import { useTenant } from '@/tenant/TenantProvider'

/**
 * Client site layout. Below `lg` every page keeps the phone column; from `lg` up (laptops and
 * desktops) pages use the full site width with multi-column layouts and larger type.
 */
export const PAGE = 'mx-auto w-full max-w-xl md:max-w-2xl lg:max-w-[1440px] lg:px-8'

/** Section heading: small caps on the phone, a real headline on the desktop site. */
export function SiteSection({
  title,
  subtitle,
  action,
  size = 'md',
  children,
  className,
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  /** xl: home page bands; md: blocks inside a page. */
  size?: 'xl' | 'md'
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('grid content-start gap-3', size === 'xl' ? 'lg:gap-7' : 'lg:gap-4', className)}>
      {(title || action) && (
        <Reveal className="flex items-end justify-between gap-3 px-1 lg:px-0">
          <div className="grid gap-1.5">
            {title && (
              <h2
                className={cn(
                  'text-[13px] font-semibold uppercase tracking-[0.08em] text-fg-subtle lg:normal-case lg:text-fg',
                  size === 'xl' ? 'lg:text-gradient lg:text-[40px] lg:leading-tight lg:font-bold lg:tracking-tight' : 'lg:text-xl lg:tracking-normal',
                )}
              >
                {title}
              </h2>
            )}
            {subtitle && <p className={cn('hidden text-fg-muted lg:block', size === 'xl' ? 'text-lg' : 'text-[15px]')}>{subtitle}</p>}
          </div>
          {action}
        </Reveal>
      )}
      {/* Several children keep the section's spacing between them. */}
      <Reveal delay={0.08} className={cn('grid min-w-0 content-start gap-3', size === 'xl' ? 'lg:gap-7' : 'lg:gap-4')}>
        {children}
      </Reveal>
    </section>
  )
}

/** The studio's address and phone, for the side panels of the desktop pages. */
export function StudioContactCard({ className }: { className?: string }) {
  const { data } = useTenant()
  const p = data.profile
  if (!p.address && !p.phone) return null
  return (
    <Card className={cn('grid gap-4 p-6', className)}>
      <p className="text-lg font-semibold">{data.tenant.name}</p>
      {p.address && (
        <a href={p.map_url ?? undefined} target="_blank" rel="noreferrer" className="flex items-start gap-3 text-[15px] text-fg-muted hover:text-fg">
          <MapPin className="mt-0.5 size-5 shrink-0" aria-hidden />
          {p.address}
        </a>
      )}
      {p.phone && (
        <a href={`tel:${p.phone}`} className="flex items-center gap-3 text-lg font-semibold text-accent-text">
          <Phone className="size-5" aria-hidden /> {phonePretty(p.phone)}
        </a>
      )}
    </Card>
  )
}

/** Laptop/desktop layout (lg+), following window resizes. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setDesktop(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return desktop
}

/** True when motion should stay still: the OS setting or Profile → «Анимации: Меньше». */
export function useStillMotion(): boolean {
  const os = useReducedMotion()
  const { motion } = useMotionPreference()
  return motion === 'reduce' || Boolean(os)
}
