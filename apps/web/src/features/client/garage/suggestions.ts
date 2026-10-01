import type { Suggestion } from '@dp/core/api/contracts'

/** Every suggestion states where it comes from; nothing is invented on the client. */
export function suggestionText(s: Suggestion): string {
  switch (s.kind) {
    case 'repeat_due': {
      const months = s.last_at ? Math.max(1, Math.round((Date.now() - new Date(s.last_at).getTime()) / (30 * 86400_000))) : null
      return `«${s.service_name}» в последний раз ${months ? `${months} мес. назад` : 'давно'} — пора повторить`
    }
    case 'studio_recommends':
      return `После «${s.after_service}» студия рекомендует «${s.service_name}»`
    case 'often_after':
      return `После «${s.after_service}» клиенты студии часто выбирают «${s.service_name}»`
  }
}
