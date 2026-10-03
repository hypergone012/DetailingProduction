/** Plain constants shared by the app, the pipeline and the Edge Functions (no zod). */
export const BODY_TYPES = ['hatchback', 'sedan', 'coupe', 'crossover', 'suv', 'large_suv', 'minivan', 'pickup'] as const
export type BodyType = (typeof BODY_TYPES)[number]

export const BODY_TYPE_LABELS: Record<BodyType, string> = {
  hatchback: 'Хэтчбек',
  sedan: 'Седан / универсал',
  coupe: 'Купе / кабриолет',
  crossover: 'Кроссовер',
  suv: 'Внедорожник',
  large_suv: 'Большой внедорожник',
  minivan: 'Минивэн / фургон',
  pickup: 'Пикап',
}

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/**
 * `sizes` of the cover on the studio home. The static shell preloads the cover with the same
 * value, so the browser picks the same file and reuses the preload.
 */
export const HERO_IMAGE_SIZES = '(min-width: 1024px) min(1376px, 100vw), 100vw'
