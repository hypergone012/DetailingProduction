import { LazyMotion, MotionConfig, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useMotionPreference } from '@/theme/ThemeProvider'
import features from './features'

/**
 * Respects the OS "reduce motion" setting and the in-app override (Profile → Анимации): every
 * animation then jumps to its final state. (`reducedMotion` alone only skips motion's x/y/scale;
 * moves are animated as a whole `transform`, see tokens.ts.)
 *
 * The animation features load with the app, not after it: entrances start hidden, and waiting
 * for a second request before anything could appear made every first screen late.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const { motion } = useMotionPreference()
  const os = useReducedMotion()
  const still = motion === 'reduce' || Boolean(os)
  return (
    <MotionConfig reducedMotion={motion === 'reduce' ? 'always' : 'user'} skipAnimations={still}>
      <LazyMotion features={features} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  )
}
