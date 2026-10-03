import { animate, m, useInView, type Variants } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useAppTheme } from '@/theme/ThemeProvider'
import { ease, move, settled } from './tokens'

// Blur on large screens only: a filter animation repaints on the CPU every frame, which phones
// pay for exactly while the page is loading. Phones get the same rise without the blur.
export const BLUR = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches

/** Content rises into place (un-blurring on desktop) the first time it scrolls into view. */
const rise: Variants = BLUR
  ? {
      hidden: { opacity: 0, transform: move(0, 26), filter: 'blur(6px)' },
      show: { opacity: 1, ...settled, filter: 'blur(0px)', transition: { duration: 0.5, ease: ease.out } },
    }
  : {
      hidden: { opacity: 0, transform: move(0, 18) },
      show: { opacity: 1, ...settled, transition: { duration: 0.4, ease: ease.out } },
    }

// Starts as soon as a block peeks into view, so fast scrolling never waits for content.
const VIEWPORT = { once: true, amount: 0.04, margin: '0px 0px -2% 0px' } as const

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <m.div className={className} variants={rise} initial="hidden" whileInView="show" viewport={VIEWPORT} transition={{ delay }}>
      {children}
    </m.div>
  )
}

const group: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } } }

/** A list or grid whose items rise one after another when it scrolls into view. */
export function RevealGroup({
  children,
  className,
  as = 'div',
  ...rest
}: { children: ReactNode; className?: string; as?: 'div' | 'ul' | 'ol' | 'dl'; role?: string; tabIndex?: number; 'aria-label'?: string }) {
  const Comp = as === 'ul' ? m.ul : as === 'ol' ? m.ol : as === 'dl' ? m.dl : m.div
  return (
    <Comp className={className} variants={group} initial="hidden" whileInView="show" viewport={VIEWPORT} {...rest}>
      {children}
    </Comp>
  )
}

export function RevealItem({ children, className, as = 'div', style }: { children: ReactNode; className?: string; as?: 'div' | 'li' | 'figure'; style?: React.CSSProperties }) {
  const Comp = as === 'li' ? m.li : as === 'figure' ? m.figure : m.div
  return (
    <Comp className={className} variants={rise} style={style}>
      {children}
    </Comp>
  )
}

/** Counts up to a number when it first comes into view (instantly with reduced motion). */
export function CountUp({ value, format = (n) => String(Math.round(n)), className, delay = 0 }: { value: number; format?: (n: number) => string; className?: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const { motion } = useAppTheme()
  const reduce = motion === 'reduce' || (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const formatRef = useRef(format)
  useLayoutEffect(() => {
    formatRef.current = format
  })
  useEffect(() => {
    const el = ref.current
    if (!el || !inView || reduce) return
    const controls = animate(0, value, { duration: 1.6, delay, ease: ease.out, onUpdate: (n) => (el.textContent = formatRef.current(n)) })
    return () => controls.stop()
  }, [inView, value, reduce, delay])
  return (
    <span className={className}>
      <span className="sr-only">{format(value)}</span>
      <span ref={ref} aria-hidden>
        {format(reduce ? value : 0)}
      </span>
    </span>
  )
}
