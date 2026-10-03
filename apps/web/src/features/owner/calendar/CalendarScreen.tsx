import { wallClock, zonedToInstant } from '@dp/core/time/zoned'
import { CalendarPlus, ChevronLeft, ChevronRight, Lock, MessageSquareText } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router'
import { ScreenHeader } from '@/components/ScreenHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api/http'
import { addDays, dateLong, time, today } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CalendarData, CalendarItem } from '../api/types'
import { useCalendar, useOwner } from '../data'
import { BLOCK_REASON_LABEL, STATUS_CARD } from '../shared/labels'
import { useSheets } from '../shared/sheets'
import { DateInput } from '../shared/TimeField'

const PX_PER_MIN = 1.2
const SNAP_MIN = 15

interface Layout {
  dayStart: number // epoch ms of local midnight
  viewFrom: number // minutes after local midnight
  viewTo: number
}

function minutesOf(iso: string, dayStart: number): number {
  return (new Date(iso).getTime() - dayStart) / 60000
}

function layoutFor(data: CalendarData | undefined, date: string, tz: string): Layout {
  const dayStart = zonedToInstant(date, '00:00', tz).getTime()
  const dayLen = (zonedToInstant(addDays(date, 1), '00:00', tz).getTime() - dayStart) / 60000
  let from = 8 * 60
  let to = 21 * 60
  if (data?.windows.length) {
    from = Math.min(...data.windows.map((w) => minutesOf(w.starts_at, dayStart)))
    to = Math.max(...data.windows.map((w) => minutesOf(w.ends_at, dayStart)))
  }
  for (const it of data?.items ?? []) {
    from = Math.min(from, Math.max(0, minutesOf(it.starts_at, dayStart)))
    to = Math.max(to, Math.min(dayLen, minutesOf(it.ends_at, dayStart)))
  }
  return { dayStart, viewFrom: Math.max(0, Math.floor(from / 60) * 60 - 60), viewTo: Math.min(dayLen, Math.ceil(to / 60) * 60 + 60) }
}

export function CalendarScreen() {
  const { tz, locale, canManage } = useOwner()
  const [params, setParams] = useSearchParams()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today(tz)
  const setDate = (d: string) => setParams((p) => (p.set('date', d), p), { replace: true })
  const cal = useCalendar(date, 1)
  const sheets = useSheets()
  const layout = useMemo(() => layoutFor(cal.data, date, tz), [cal.data, date, tz])
  const bookings = cal.data?.items.filter((i) => i.kind === 'booking').length ?? 0

  return (
    <>
      <ScreenHeader
        title="Календарь"
        wide
        actions={
          canManage && (
            <Button size="sm" onClick={() => sheets.open({ new: 'booking', day: date })}>
              <CalendarPlus /> Запись
            </Button>
          )
        }
      />
      <div className="mx-auto grid max-w-6xl gap-3 px-4 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="icon-sm" aria-label="Предыдущий день" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft />
          </Button>
          <Button variant="secondary" size="icon-sm" aria-label="Следующий день" onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight />
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold first-letter:uppercase">{dateLong(zonedToInstant(date, '12:00', tz), tz, locale)}</h2>
          {date !== today(tz) && (
            <Button variant="ghost" size="sm" onClick={() => setDate(today(tz))}>
              Сегодня
            </Button>
          )}
          <DateInput aria-label="Выбрать дату" className="h-9 w-[150px] text-sm pointer-coarse:h-11" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <p className="text-sm text-fg-muted" aria-live="polite">
          {cal.isPending ? 'Загрузка…' : cal.isError ? errorMessage(cal.error) : bookings ? `Записей: ${bookings}` : 'Записей нет'}
          {cal.data && cal.data.windows.length === 0 && ' · по расписанию выходной'}
        </p>
        {cal.isPending ? (
          <Skeleton className="h-[60vh] rounded-2xl" />
        ) : cal.data && cal.data.resources.length === 0 ? (
          <p className="rounded-2xl bg-sunken p-4 text-sm text-fg-muted">Нет активных ресурсов (боксов, постов). Добавьте их в разделе «Студия → Расписание и ресурсы».</p>
        ) : cal.data ? (
          <Lanes data={cal.data} date={date} layout={layout} />
        ) : null}
      </div>
    </>
  )
}

function Lanes({ data, date, layout }: { data: CalendarData; date: string; layout: Layout }) {
  const { tz, canManage } = useOwner()
  const sheets = useSheets()
  const height = (layout.viewTo - layout.viewFrom) * PX_PER_MIN
  const y = (minutes: number) => (minutes - layout.viewFrom) * PX_PER_MIN
  const hours = useMemo(() => {
    const out: { top: number; label: string }[] = []
    for (let m = Math.ceil(layout.viewFrom / 60) * 60; m <= layout.viewTo; m += 60) {
      out.push({ top: y(m), label: wallClock(new Date(layout.dayStart + m * 60000), tz).time })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, tz])
  const closed = useMemo(() => {
    // Shade everything outside working windows.
    const open = data.windows.map((w) => [minutesOf(w.starts_at, layout.dayStart), minutesOf(w.ends_at, layout.dayStart)] as const)
    const gaps: [number, number][] = []
    let cursor = layout.viewFrom
    for (const [s, e] of open.sort((a, b) => a[0] - b[0])) {
      if (s > cursor) gaps.push([cursor, Math.min(s, layout.viewTo)])
      cursor = Math.max(cursor, e)
    }
    if (cursor < layout.viewTo) gaps.push([cursor, layout.viewTo])
    return gaps
  }, [data.windows, layout])
  const now = useNow()
  const nowMin = (now - layout.dayStart) / 60000
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Start near now (today) or the opening time instead of the top of the range.
    const first = closed[0] && closed[0][0] === layout.viewFrom ? closed[0][1] : layout.viewFrom
    const target = nowMin > layout.viewFrom && nowMin < layout.viewTo ? nowMin - 60 : first - 30
    scroller.current?.scrollTo({ top: Math.max(0, y(target)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const onLaneClick = (e: MouseEvent<HTMLDivElement>, resourceId: string) => {
    if (!canManage || e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const minutes = Math.floor((e.clientY - rect.top) / PX_PER_MIN / SNAP_MIN) * SNAP_MIN + layout.viewFrom
    const at = wallClock(new Date(layout.dayStart + minutes * 60000), tz)
    sheets.open({ new: 'booking', day: at.day, time: at.time, resource: resourceId })
  }

  return (
    <div
      ref={scroller}
      className="max-h-[calc(100dvh-var(--dp-nav-height)-var(--dp-safe-bottom)-170px)] overflow-auto overscroll-contain rounded-2xl border border-line bg-surface md:max-h-[calc(100dvh-160px)]"
    >
      <div className="grid min-w-full" style={{ gridTemplateColumns: `52px repeat(${data.resources.length}, minmax(148px, 1fr))`, width: 'max-content' }}>
        <div className="sticky top-0 left-0 z-30 border-b border-line bg-surface" />
        {data.resources.map((r) => (
          <div key={r.id} className="sticky top-0 z-20 truncate border-b border-l border-line bg-surface px-3 py-2.5 text-sm font-semibold">
            {r.name}
          </div>
        ))}
        <div className="sticky left-0 z-10 bg-surface" style={{ height }}>
          {hours.map((h) => (
            <span key={h.top} className="absolute right-2 -translate-y-1/2 text-[11px] text-fg-subtle tabular" style={{ top: h.top }}>
              {h.label}
            </span>
          ))}
        </div>
        {data.resources.map((r) => (
          // Tapping free space is a pointer shortcut that pre-fills time and lane; the lane is not
          // a control itself (it holds the booking buttons). Keyboard users have the "Запись" button above.
          <div
            key={r.id}
            className={cn('relative border-l border-line', canManage && 'cursor-copy')}
            style={{ height }}
            onClick={(e) => onLaneClick(e, r.id)}
          >
            {hours.map((h) => (
              <span key={h.top} className="pointer-events-none absolute inset-x-0 border-t border-line/60" style={{ top: h.top }} aria-hidden />
            ))}
            {closed.map(([s, e]) => (
              <span key={s} className="dp-closed pointer-events-none absolute inset-x-0" style={{ top: y(s), height: (e - s) * PX_PER_MIN }} aria-hidden />
            ))}
            {data.items
              .filter((it) => it.resource_id === r.id)
              .map((it) => (
                <ItemCard key={it.id} item={it} layout={layout} />
              ))}
            {nowMin > layout.viewFrom && nowMin < layout.viewTo && (
              <span className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: y(nowMin) }} aria-hidden />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])
  return now
}

function ItemCard({ item, layout }: { item: CalendarItem; layout: Layout }) {
  const { tz } = useOwner()
  const sheets = useSheets()
  const start = Math.max(layout.viewFrom, minutesOf(item.starts_at, layout.dayStart))
  const end = Math.min(layout.viewTo, minutesOf(item.ends_at, layout.dayStart))
  const top = (start - layout.viewFrom) * PX_PER_MIN
  const h = Math.max(30, (end - start) * PX_PER_MIN - 2)
  const continuesBefore = minutesOf(item.starts_at, layout.dayStart) < layout.viewFrom
  const continuesAfter = minutesOf(item.ends_at, layout.dayStart) > layout.viewTo

  if (item.kind === 'block') {
    return (
      <button
        type="button"
        onClick={() => sheets.open({ block: item.id })}
        className="dp-hatched absolute inset-x-1 z-[5] flex flex-col justify-start overflow-hidden rounded-lg border border-line-strong px-2 py-1 text-left text-xs text-fg-muted outline-none focus-visible:ring-2 focus-visible:ring-focus"
        style={{ top, height: h }}
      >
        <span className="flex items-center gap-1 font-medium text-fg">
          <Lock className="size-3" aria-hidden /> {item.block!.title || BLOCK_REASON_LABEL[item.block!.reason]}
        </span>
        <span className="tabular">
          {time(item.starts_at, tz)}–{time(item.ends_at, tz)}
        </span>
      </button>
    )
  }

  const b = item.booking!
  // The occupancy includes buffers; show the work itself as the solid part.
  const workTop = (Math.max(start, minutesOf(b.starts_at, layout.dayStart)) - start) * PX_PER_MIN
  const workH = Math.max(0, (Math.min(end, minutesOf(b.ends_at, layout.dayStart)) - Math.max(start, minutesOf(b.starts_at, layout.dayStart))) * PX_PER_MIN)
  return (
    <button
      type="button"
      onClick={() => sheets.open({ booking: b.id })}
      className={cn(
        'absolute inset-x-1 z-[5] flex flex-col justify-start overflow-hidden rounded-lg border text-left outline-none transition-shadow hover:shadow-card focus-visible:ring-2 focus-visible:ring-focus',
        STATUS_CARD[b.status],
        continuesBefore && 'rounded-t-none',
        continuesAfter && 'rounded-b-none',
      )}
      style={{ top, height: h, borderTopStyle: continuesBefore ? 'dashed' : undefined, borderBottomStyle: continuesAfter ? 'dashed' : undefined }}
      aria-label={`${time(b.starts_at, tz)} ${b.customer.name}, ${b.service_name}`}
    >
      <span className="pointer-events-none absolute inset-x-0 bg-fg/[0.04]" style={{ top: workTop, height: workH }} aria-hidden />
      <span className="relative grid gap-0.5 px-2 py-1 text-xs">
        <span className="flex items-center gap-1 font-semibold tabular text-fg">
          {time(b.starts_at, tz)}–{time(b.ends_at, tz)}
          {b.status === 'pending' && <Badge tone="warning" className="h-4 px-1 text-[10px]">?</Badge>}
          {b.customer_note && <MessageSquareText className="size-3 text-fg-muted" aria-label="Есть комментарий клиента" />}
        </span>
        <span className="truncate font-medium text-fg">{b.customer.name}</span>
        <span className="truncate text-fg-muted">{b.service_name}</span>
        {b.vehicle && (
          <span className="truncate text-fg-muted">
            {b.vehicle.make} {b.vehicle.model}
            {b.vehicle.plate ? ` · ${b.vehicle.plate}` : ''}
          </span>
        )}
      </span>
    </button>
  )
}
