import { LazyMotion, MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'
import { useAppTheme } from '@/theme/ThemeProvider'

// Animation features load after first paint; until then `m.*` elements render statically.
const loadFeatures = () => import('./features').then((mod) => mod.default)

/**
 * Respects the OS "reduce motion" setting and the in-app override (Profile → Анимации).
 * With reducedMotion, transforms are skipped and only opacity changes remain.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const { motion } = useAppTheme()
  return (
    <MotionConfig reducedMotion={motion === 'reduce' ? 'always' : 'user'}>
      <LazyMotion features={loadFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  )
}
