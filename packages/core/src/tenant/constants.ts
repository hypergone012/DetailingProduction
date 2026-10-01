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
