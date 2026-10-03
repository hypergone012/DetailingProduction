import { AnimatePresence, m, type Variants } from 'motion/react'
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigationType } from 'react-router'
import { dur, ease } from '@/motion/tokens'
import { useTenant } from '@/tenant/TenantProvider'
import { tabIndexOf } from './tabs'

type Move = { kind: 'tab'; dir: number } | { kind: 'push' } | { kind: 'pop' } | { kind: 'none' }

const variants: Variants = {
  enter: (mv: Move) =>
    mv.kind === 'tab' ? { opacity: 0, x: mv.dir * 28 } : mv.kind === 'push' ? { opacity: 0, x: 40 } : mv.kind === 'pop' ? { opacity: 0, x: -28 } : { opacity: 0 },
  center: { opacity: 1, x: 0, transition: { duration: dur.base, ease: ease.out } },
  exit: (mv: Move) => ({
    opacity: 0,
    x: mv.kind === 'tab' ? mv.dir * -18 : mv.kind === 'push' ? -18 : mv.kind === 'pop' ? 28 : 0,
    transition: { duration: dur.fast, ease: ease.inOut },
  }),
}

const scrollPositions = new Map<string, number>()

/**
 * Spatial navigation: sibling tabs slide left/right in tab order, drilling into a detail
 * pushes from the right, going back pops. Scroll position is restored on Back.
 */
export function ScreenTransition({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navType = useNavigationType()
  const { slug } = useTenant()
  const segs = location.pathname.slice(`/s/${slug}`.length).split('/').filter(Boolean)
  const current = { tab: tabIndexOf(segs[0]), depth: segs.length }
  // Direction is derived from the previous screen (state adjusted during render, no extra commit).
  const [nav, setNav] = useState<{ path: string; at: typeof current; move: Move }>({ path: location.pathname, at: current, move: { kind: 'none' } })
  if (nav.path !== location.pathname) {
    const p = nav.at
    const next: Move =
      p.tab !== current.tab ? { kind: 'tab', dir: Math.sign(current.tab - p.tab) } : current.depth > p.depth ? { kind: 'push' } : current.depth < p.depth ? { kind: 'pop' } : { kind: 'none' }
    setNav({ path: location.pathname, at: current, move: next })
  }
  const move = nav.move

  useLayoutEffect(() => {
    const save = () => scrollPositions.set(location.key, window.scrollY)
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [location.key])

  return (
    // `initial` stays on: the first screen fades in, and the entrance animations inside it
    // (cover, sections) play on the first visit too — initial={false} would freeze them all.
    <AnimatePresence mode="wait" custom={move}>
      <m.div
        key={location.pathname}
        custom={move}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        onAnimationStart={(def) => {
          if (def === 'center') window.scrollTo(0, navType === 'POP' ? (scrollPositions.get(location.key) ?? 0) : 0)
        }}
      >
        {children}
      </m.div>
    </AnimatePresence>
  )
}
