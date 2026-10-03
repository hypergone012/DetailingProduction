import { LazyMotion, MotionConfig, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useAppTheme } from '@/theme/ThemeProvider'

// Animation features load after first paint; until then `m.*` elements render statically.
const loadFeatures = () => import('./features').then((mod) => mod.default)

/**
 * Respects the OS "reduce motion" setting and the in-app override (Profile → Анимации): every
 * animation then jumps to its final state. (`reducedMotion` alone only skips motion's x/y/scale;
 * moves are animated as a whole `transform`, see tokens.ts.)
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const { motion } = useAppTheme()
  const os = useReducedMotion()
  const still = motion === 'reduce' || Boolean(os)
  return (
    <MotionConfig reducedMotion={motion === 'reduce' ? 'always' : 'user'} skipAnimations={still}>
      <LazyMotion features={loadFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  )
}
