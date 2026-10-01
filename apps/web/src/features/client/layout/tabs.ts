import { CalendarPlus, CarFront, History, House, UserRound, type LucideIcon } from 'lucide-react'

export interface Tab {
  key: string
  segment: string
  label: string
  icon: LucideIcon
}

/** Spatial order of the client app: transitions slide according to this order. */
export const TABS: Tab[] = [
  { key: 'home', segment: '', label: 'Главная', icon: House },
  { key: 'book', segment: 'services', label: 'Запись', icon: CalendarPlus },
  { key: 'garage', segment: 'garage', label: 'Гараж', icon: CarFront },
  { key: 'history', segment: 'history', label: 'История', icon: History },
  { key: 'profile', segment: 'profile', label: 'Профиль', icon: UserRound },
]

export function tabIndexOf(firstSegment: string | undefined): number {
  const i = TABS.findIndex((t) => t.segment === (firstSegment ?? ''))
  return i === -1 ? 0 : i
}
