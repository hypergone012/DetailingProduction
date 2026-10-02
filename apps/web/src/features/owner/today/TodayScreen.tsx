import type { BookingStatus } from '@dp/core/api/contracts'
import { AlertTriangle, Bot, CalendarPlus, ChevronRight, Clock } from 'lucide-react'
import { Link } from 'react-router'
import { useChatParam } from '@/components/assistant/chatParam'
import { ScreenHeader } from '@/components/ScreenHeader'
import { Section } from '@/components/Section'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api/http'
import { addDays, dateLong, money, plural, time, today, when } from '@/lib/format'
import { useTenant } from '@/tenant/TenantProvider'
import { rpc } from '../api/client'
import type { CalendarItem } from '../api/types'
import { useCalendar, useOwner, useOwnerMutation, useStats } from '../data'
import { nextActions } from '../shared/labels'
import { Stat } from '../shared/Row'
import { useSheets } from '../shared/sheets'

export function TodayScreen() {
  const { tz, locale, slug, canManage } = useOwner()
  const { data } = useTenant()
  const sheets = useSheets()
  const chat = useChatParam()
  const day = today(tz)
  const cal = useCalendar(day, 1)
  const ahead = useCalendar(day, 14)
  const resources = new Map((cal.data?.resources ?? []).map((r) => [r.id, r.name]))
  const items = (cal.data?.items ?? []).filter((i) => i.kind === 'booking')
  const pending = (ahead.data?.items ?? []).filter((i) => i.booking?.status === 'pending')

  return (
    <>
      <ScreenHeader
        title="Сегодня"
        large
        wide
        actions={
          <>
            {data.features.ai !== false && (
              <Button variant="ghost" size="icon" aria-label="Помощник" onClick={chat.show}>
                <Bot />
              </Button>
            )}
            {canManage && (
              <Button size="sm" onClick={() => sheets.open({ new: 'booking', day })}>
                <CalendarPlus /> Запись
              </Button>
            )}
          </>
        }
      />
      <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-8">
        <p className="text-fg-muted first-letter:uppercase">{dateLong(new Date(), tz, locale)}</p>
        {data.tenant.status === 'demo' && (
          <Link to={`/s/${slug}/owner/settings#status`} className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning-subtle p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            <span className="grid gap-0.5">
              <b className="font-semibold">Демо-режим</b>
              <span className="text-fg-muted">Записи помечаются как демонстрационные, уведомления не отправляются. Когда всё готово — переведите студию в рабочий режим.</span>
            </span>
            <ChevronRight className="ml-auto size-4 shrink-0 self-center text-fg-subtle" aria-hidden />
          </Link>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid content-start gap-6">
            <Section title={items.length ? `План на день · ${items.length} ${plural(items.length, 'запись', 'записи', 'записей')}` : 'План на день'}>
              {cal.isPending ? (
                <Skeleton className="h-40 rounded-2xl" />
              ) : cal.isError ? (
                <p className="text-sm text-danger">{errorMessage(cal.error)}</p>
              ) : items.length === 0 ? (
                <p className="rounded-2xl bg-sunken p-4 text-sm text-fg-muted">{cal.data?.windows.length ? 'На сегодня записей нет.' : 'Сегодня выходной по расписанию.'}</p>
              ) : (
                <ul className="grid gap-2">
                  {items.map((it) => (
                    <AgendaRow key={it.id} item={it} resource={resources.get(it.resource_id)} />
                  ))}
                </ul>
              )}
            </Section>
            {pending.length > 0 && (
              <Section title={`Ждут подтверждения · ${pending.length}`}>
                <ul className="grid gap-2">
                  {pending.map((it) => (
                    <AgendaRow key={it.id} item={it} showDay />
                  ))}
                </ul>
              </Section>
            )}
          </div>
          <MoneyPanel />
        </div>
      </div>
    </>
  )
}

function AgendaRow({ item, resource, showDay = false }: { item: CalendarItem; resource?: string; showDay?: boolean }) {
  const { tz, locale } = useOwner()
  const sheets = useSheets()
  const b = item.booking!
  const action = nextActions(b.status).find((a) => a.primary)
  const set = useOwnerMutation((status: BookingStatus) => rpc('owner_set_booking_status', { p_booking: b.id, p_status: status }))
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <button type="button" onClick={() => sheets.open({ booking: b.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <span className="grid w-14 shrink-0 justify-items-center rounded-xl bg-sunken py-2">
          <Clock className="size-3.5 text-fg-subtle" aria-hidden />
          <span className="text-sm font-semibold tabular">{time(b.starts_at, tz, locale)}</span>
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate font-medium">{b.customer.name}</span>
          <span className="truncate text-sm text-fg-muted">
            {showDay ? `${when(b.starts_at, tz, locale)} · ` : ''}
            {b.service_name}
            {b.vehicle ? ` · ${b.vehicle.make} ${b.vehicle.model}` : ''}
            {resource ? ` · ${resource}` : ''}
          </span>
          <span className="flex items-center gap-2">
            <StatusBadge status={b.status} />
          </span>
        </span>
      </button>
      {action && (
        <Button size="sm" variant="secondary" loading={set.isPending} onClick={() => set.mutate(action.status)} title={set.error ? errorMessage(set.error) : undefined}>
          {action.label}
        </Button>
      )}
    </li>
  )
}

/**
 * Three different money figures, never added together:
 *   planned   — price of upcoming bookings (not earned yet),
 *   completed — price of work done (earned, maybe unpaid),
 *   received  — payments actually recorded (cash in).
 */
function MoneyPanel() {
  const { tz, locale, currency, canManage } = useOwner()
  const day = today(tz)
  const todayStats = useStats(day, day)
  const month = useStats(addDays(day, -29), day)
  const next = useStats(day, addDays(day, 30))
  const m = (cents: number | null | undefined) => (cents === null || cents === undefined ? '—' : money(cents, currency, locale))
  const util = month.data?.utilization.ratio
  return (
    <div className="grid content-start gap-6">
      <Section title="Сегодня">
        {todayStats.isPending ? (
          <Skeleton className="h-28 rounded-2xl" />
        ) : todayStats.data ? (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Записей" value={todayStats.data.scheduled.count} hint={`выполнено ${todayStats.data.completed.count}`} />
            {canManage && todayStats.data.money_visible ? (
              <>
                <Stat label="Выполнено работ" value={m(todayStats.data.completed.value_cents)} />
                <Stat label="Получено оплат" value={m(todayStats.data.payments?.received_cents)} />
                <Stat label="Ещё впереди сегодня" value={m(todayStats.data.upcoming.value_cents)} hint="не выручка, пока не выполнено" tone="muted" />
              </>
            ) : (
              <Stat label="Впереди" value={todayStats.data.upcoming.count} />
            )}
          </div>
        ) : (
          <p className="text-sm text-danger">{errorMessage(todayStats.error)}</p>
        )}
      </Section>
      <Section title="30 дней">
        {month.isPending ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : month.data ? (
          <div className="grid grid-cols-2 gap-3">
            {month.data.money_visible && (
              <>
                <Stat label="Выполнено работ" value={m(month.data.completed.value_cents)} hint={`${month.data.completed.count} ${plural(month.data.completed.count, 'визит', 'визита', 'визитов')}`} />
                <Stat label="Получено оплат" value={m(month.data.payments?.received_cents)} hint={month.data.payments?.refunds_cents ? `возвраты ${m(month.data.payments.refunds_cents)}` : undefined} />
                <Stat label="Средний чек" value={m(month.data.average_ticket_cents)} />
              </>
            )}
            <Stat label="Загрузка" value={util === null || util === undefined ? '—' : `${Math.round(util * 100)}%`} hint="занято от рабочего времени" />
            <Stat label="Новые клиенты" value={month.data.clients.new} hint={`вернулись ${month.data.clients.returning}`} />
            <Stat label="Отмены / неявки" value={`${month.data.cancelled.count} / ${month.data.no_show.count}`} />
          </div>
        ) : (
          <p className="text-sm text-danger">{errorMessage(month.error)}</p>
        )}
      </Section>
      {canManage && next.data?.money_visible && (
        <Section title="В записи на 30 дней вперёд">
          <Stat label="Запланировано" value={m(next.data.upcoming.value_cents)} hint={`${next.data.upcoming.count} ${plural(next.data.upcoming.count, 'запись', 'записи', 'записей')} · это будущие деньги, не выручка`} tone="muted" />
        </Section>
      )}
    </div>
  )
}
