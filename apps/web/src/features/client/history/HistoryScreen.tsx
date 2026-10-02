import type { BookingSummary } from '@dp/core/api/contracts'
import { useQueries } from '@tanstack/react-query'
import { CalendarDays, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { money, when } from '@/lib/format'
import { storage } from '@/lib/storage'
import { Stagger, StaggerItem } from '@/motion/Stagger'
import { useTenant } from '@/tenant/TenantProvider'
import { useBookingFlow } from '../booking/flow'
import { ScreenHeader } from '@/components/ScreenHeader'
import { isUpcoming, keys, useProfile } from '../data'
import { EmptyState, Section } from '@/components/Section'
import { StatusBadge } from '@/components/StatusBadge'

export function HistoryScreen() {
  const { slug, api } = useTenant()
  const { profile, isFetching } = useProfile()
  const flow = useBookingFlow()
  const own = profile?.bookings ?? []
  // Bookings opened through a studio link on this device but not created by its profile.
  const linked = Object.keys(storage.getJson<Record<string, string>>(`${slug}:tokens`, {})).filter((id) => !own.some((b) => b.id === id))
  const linkedQ = useQueries({
    queries: linked.map((id) => ({ queryKey: keys.booking(slug, id), queryFn: () => api.booking(id), retry: false, staleTime: 30_000 })),
  })
  const extra: BookingSummary[] = linkedQ.flatMap((q) =>
    q.data
      ? [{ ...q.data.booking, service_id: q.data.booking.service.id, service_name: q.data.booking.service.name, vehicle_id: q.data.booking.vehicle?.id ?? null, media: [] }]
      : [],
  )
  const all = [...own, ...extra]
  const upcoming = all.filter(isUpcoming).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const past = all.filter((b) => !isUpcoming(b)).sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  return (
    <>
      <ScreenHeader title="Мои записи" large />
      <div className="mx-auto grid max-w-xl md:max-w-2xl gap-6 px-4 pt-1 pb-8">
        {!profile && isFetching ? (
          <div className="grid gap-3">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        ) : all.length === 0 ? (
          <EmptyState icon={<CalendarDays />} title="Записей пока нет" text="Здесь появятся ваши визиты и история обслуживания." action={<Button onClick={() => flow.start()}>Записаться</Button>} />
        ) : (
          <>
            {upcoming.length > 0 && (
              <Section title="Предстоящие">
                <List items={upcoming} />
              </Section>
            )}
            {past.length > 0 && (
              <Section title="Прошедшие">
                <List items={past} />
              </Section>
            )}
          </>
        )}
      </div>
    </>
  )
}

function List({ items }: { items: BookingSummary[] }) {
  const { slug, tz, locale } = useTenant()
  return (
    <Stagger as="ul" className="grid gap-2">
      {items.map((b) => (
        <StaggerItem as="li" key={b.id}>
          <Link to={`/s/${slug}/history/${b.id}`} className="pressable flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-card outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <div className="grid min-w-0 flex-1 gap-1">
              <p className="truncate font-medium">{b.service_name}</p>
              <p className="text-sm text-fg-muted first-letter:uppercase">{when(b.starts_at, tz, locale)}</p>
            </div>
            <div className="grid justify-items-end gap-1">
              <span className="text-sm font-semibold tabular">{money(b.price_cents, b.currency, locale)}</span>
              <StatusBadge status={b.status} />
            </div>
            <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
          </Link>
        </StaggerItem>
      ))}
    </Stagger>
  )
}
