import type { BookingSummary } from '@dp/core/api/contracts'
import { useQueries } from '@tanstack/react-query'
import { CalendarDays, CalendarPlus, ChevronRight } from 'lucide-react'
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
import { Card, EmptyState } from '@/components/Section'
import { cn } from '@/lib/utils'
import { PAGE, SiteSection, StudioContactCard } from '../layout/site'
import { ServicePicks } from '../shared/ServicePicks'
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
      <ScreenHeader title="Мои записи" large site subtitle="Предстоящие визиты и история обслуживания." />
      <div className={cn(PAGE, 'grid gap-6 px-4 pt-1 pb-8 lg:grid-cols-12 lg:items-start lg:gap-8 lg:pt-0 lg:pb-4')}>
        <div className="contents lg:col-span-8 lg:grid lg:gap-10">
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
              <SiteSection title="Предстоящие">
                <List items={upcoming} />
              </SiteSection>
            )}
            {past.length > 0 && (
              <SiteSection title="Прошедшие">
                <List items={past} />
              </SiteSection>
            )}
          </>
        )}
        {(profile || !isFetching) && <ServicePicks title={all.length ? "Записаться снова" : undefined} />}
        </div>
        <HistoryAside all={all} upcoming={upcoming.length} />
      </div>
    </>
  )
}

function List({ items }: { items: BookingSummary[] }) {
  const { slug, tz, locale } = useTenant()
  return (
    <Stagger as="ul" className="grid gap-2 lg:gap-3">
      {items.map((b) => (
        <StaggerItem as="li" key={b.id}>
          <Link
            to={`/s/${slug}/history/${b.id}`}
            className="pressable lift spotlight flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-card outline-none focus-visible:ring-2 focus-visible:ring-focus lg:gap-6 lg:rounded-3xl lg:p-5"
          >
            <span className="hidden size-16 shrink-0 place-items-center rounded-2xl bg-accent-subtle text-accent-text lg:grid">
              <span className="text-xs uppercase leading-none text-fg-muted">{new Intl.DateTimeFormat(locale, { timeZone: tz, month: 'short' }).format(new Date(b.starts_at)).replace('.', '')}</span>
              <span className="text-2xl leading-none font-bold tabular">{new Intl.DateTimeFormat(locale, { timeZone: tz, day: 'numeric' }).format(new Date(b.starts_at))}</span>
            </span>
            <div className="grid min-w-0 flex-1 gap-1">
              <p className="truncate font-medium lg:text-xl lg:font-semibold">{b.service_name}</p>
              <p className="text-sm text-fg-muted first-letter:uppercase lg:text-base">{when(b.starts_at, tz, locale)}</p>
            </div>
            <div className="grid justify-items-end gap-1 lg:gap-2">
              <span className="text-sm font-semibold tabular lg:text-xl lg:font-bold">{money(b.price_cents, b.currency, locale)}</span>
              <StatusBadge status={b.status} />
            </div>
            <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
          </Link>
        </StaggerItem>
      ))}
    </Stagger>
  )
}

/** Desktop side panel: visits at a glance, a new booking, the studio's contacts. */
function HistoryAside({ all, upcoming }: { all: BookingSummary[]; upcoming: number }) {
  const { currency, locale } = useTenant()
  const flow = useBookingFlow()
  const done = all.filter((b) => b.status === 'completed')
  const spent = done.reduce((sum, b) => sum + b.price_cents, 0)
  const stats = [
    { label: 'Предстоящих', value: String(upcoming) },
    { label: 'Визитов', value: String(done.length) },
    { label: 'Сумма визитов', value: money(spent, done[0]?.currency ?? currency, locale) },
  ]
  return (
    <aside className="hidden content-start gap-6 lg:sticky lg:top-[calc(var(--dp-header-offset,0px)+24px)] lg:col-span-4 lg:grid">
      <Card className="grid gap-5 rounded-3xl p-6">
        <p className="text-xl font-semibold">Ваши визиты</p>
        <dl className="grid grid-cols-3 gap-3">
          {stats.map((st) => (
            <div key={st.label} className="grid gap-1 rounded-2xl bg-sunken p-3.5">
              <dt className="order-2 text-xs text-fg-muted">{st.label}</dt>
              <dd className="order-1 truncate text-lg font-bold tabular">{st.value}</dd>
            </div>
          ))}
        </dl>
        <Button size="lg" block onClick={() => flow.start()}>
          <CalendarPlus /> Новая запись
        </Button>
      </Card>
      <StudioContactCard className="rounded-3xl" />
    </aside>
  )
}
