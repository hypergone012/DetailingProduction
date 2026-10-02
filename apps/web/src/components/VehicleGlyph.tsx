import { cn } from '@/lib/utils'

/** Neutral body silhouette used when a vehicle has no photo (drawn in currentColor). */
export function VehicleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 48" className={cn('text-fg-subtle', className)} aria-hidden fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M8 34 L8 27 C8 24 12 22 20 21 L38 19 L52 9 C55 7 60 6 66 6 L82 6 C88 6 92 8 96 12 L104 20 C110 21 114 24 114 28 L114 34" />
      <path d="M8 34 H22 M42 34 H80 M100 34 H114" />
      <circle cx="32" cy="35" r="8" />
      <circle cx="90" cy="35" r="8" />
      <path d="M52 19 L56 10 L82 10 L94 19 Z" opacity="0.45" />
    </svg>
  )
}
