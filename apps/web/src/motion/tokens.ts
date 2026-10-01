import type { Transition, Variants } from 'motion/react'

/** Motion vocabulary. Short, purposeful, never blocking input. */
export const ease = {
  out: [0.25, 1, 0.5, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
}

export const dur = { fast: 0.16, base: 0.26, slow: 0.38 }

export const spring: Transition = { type: 'spring', stiffness: 520, damping: 44, mass: 0.9 }
export const softSpring: Transition = { type: 'spring', stiffness: 320, damping: 34 }

/** Horizontal spatial transition between sibling tabs (direction: -1 left, 1 right). */
export const tabVariants: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 28 }),
  center: { opacity: 1, x: 0, transition: { duration: dur.base, ease: ease.out } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -20, transition: { duration: dur.fast, ease: ease.inOut } }),
}

/** Drill-down (push) transition for detail screens. */
export const pushVariants: Variants = {
  enter: { opacity: 0, x: 36 },
  center: { opacity: 1, x: 0, transition: { duration: dur.base, ease: ease.out } },
  exit: { opacity: 0, x: -16, transition: { duration: dur.fast } },
}

export const listContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } },
}

export const listItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: dur.base, ease: ease.out } },
}

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: dur.slow, ease: ease.out } },
}
