import { CalendarDays, LayoutDashboard, Settings, Sparkles, Users, type LucideIcon } from 'lucide-react'

export interface OwnerTab {
  segment: string
  label: string
  icon: LucideIcon
}

export const OWNER_TABS: OwnerTab[] = [
  { segment: '', label: 'Сегодня', icon: LayoutDashboard },
  { segment: 'calendar', label: 'Календарь', icon: CalendarDays },
  { segment: 'customers', label: 'Клиенты', icon: Users },
  { segment: 'services', label: 'Услуги', icon: Sparkles },
  { segment: 'settings', label: 'Студия', icon: Settings },
]

export function ownerTabIndex(pathname: string, slug: string): number {
  const first = pathname.slice(`/s/${slug}/owner`.length).split('/').filter(Boolean)[0] ?? ''
  const i = OWNER_TABS.findIndex((t) => t.segment === first)
  // schedule lives under "Студия"
  return i === -1 ? (first === 'schedule' ? 4 : 0) : i
}
