import type { BookingStatus } from '@dp/core/api/contracts'
import type { BlockReason, Role } from '../api/types'

export const BLOCK_REASON_LABEL: Record<BlockReason, string> = {
  maintenance: 'Обслуживание',
  closed: 'Закрыто',
  personal: 'Личное',
  reserve: 'Резерв',
  other: 'Другое',
}

export const PAYMENT_METHODS = ['card', 'cash', 'transfer', 'online', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  transfer: 'Перевод',
  online: 'Онлайн',
  other: 'Другое',
}

export const ROLE_LABEL: Record<Role, string> = { owner: 'Владелец', manager: 'Менеджер', staff: 'Сотрудник' }

export const EVENT_LABEL: Record<string, string> = {
  created: 'Создана',
  moved: 'Перенесена',
  cancelled: 'Отменена',
  confirmed: 'Подтверждена',
  started: 'Работа начата',
  completed: 'Работа завершена',
  no_show: 'Клиент не приехал',
  price_changed: 'Изменена цена',
  note_changed: 'Изменены заметки',
}

export const ACTOR_LABEL: Record<string, string> = { client: 'клиент', owner: 'студия', assistant: 'помощник', system: 'система' }

export const SOURCE_LABEL: Record<string, string> = { client: 'Онлайн', owner: 'Студия', assistant: 'Помощник' }

export interface StatusAction {
  status: BookingStatus
  label: string
  primary?: boolean
}

/** Work statuses are accepted by SQL (private.transition_booking) only from 12 h before the start. */
const WORK_STATUSES_FROM_MS = 12 * 3600_000

/**
 * The transitions private.transition_booking accepts, in the order a studio needs them.
 * "Начать работу" / "Завершить" / "Не приехал" are not offered for a booking that is still
 * more than 12 h away: the server would refuse them, so the buttons would be dead.
 */
export function nextActions(status: BookingStatus, startsAt: string, now = Date.now()): StatusAction[] {
  const early = Date.parse(startsAt) > now + WORK_STATUSES_FROM_MS
  switch (status) {
    case 'pending':
      return [{ status: 'confirmed', label: 'Подтвердить', primary: true }]
    case 'confirmed':
      return early
        ? []
        : [
            { status: 'in_progress', label: 'Начать работу', primary: true },
            { status: 'completed', label: 'Завершить' },
            { status: 'no_show', label: 'Не приехал' },
          ]
    case 'in_progress':
      return [{ status: 'completed', label: 'Завершить', primary: true }]
    default:
      return []
  }
}

/** Status colors for calendar cards (semantic tokens only). */
export const STATUS_CARD: Record<BookingStatus, string> = {
  pending: 'border-warning/60 bg-warning-subtle',
  confirmed: 'border-accent-text/50 bg-accent-subtle',
  in_progress: 'border-info/60 bg-info-subtle',
  completed: 'border-line bg-surface-2',
  cancelled: 'border-danger/40 bg-danger-subtle',
  no_show: 'border-danger/40 bg-danger-subtle',
}
