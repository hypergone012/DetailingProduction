import type { AvailabilityResponse, Slot } from '@dp/core/api/contracts'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, RefreshCw } from 'lucide-react'
import { m } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api/http'
import { addDays, dayParts, span, today } from '@/lib/format'
import { cn } from '@/lib/utils'
import { spring } from '@/motion/tokens'
import { useTenant } from '@/tenant/TenantProvider'
import { keys } from '../data'

const WINDOW = 14

interface Props {
  serviceId: string
  bodyType: string | null
  addonIds: string[]
  value: Slot | null
  onChange: (slot: Slot) => void
  /** Moving an existing booking: slots for its own snapshot duration. */
  rescheduleBookingId?: string
  onLoaded?: (a: AvailabilityResponse) => void
}

/**
 * Free slots come only from the server (availability is computed in SQL with the same
 * rules the booking transaction re-checks). This component just renders them.
 */
export function SlotPicker({ serviceId, bodyType, addonIds, value, onChange, rescheduleBookingId, onLoaded }: Props) {
  const { slug, api, tz, data } = useTenant()
  const [from, setFrom] = useState(() => today(tz))
  const horizonEnd = addDays(today(tz), data.policy.horizon_days)
  const params = { serviceId, bodyType, addonIds, from, days: WINDOW }
  const q = useQuery({
    queryKey: keys.availability(slug, { ...params, rescheduleBookingId }),
    queryFn: () => (rescheduleBookingId ? api.rescheduleAvailability(rescheduleBookingId, from, WINDOW) : api.availability(params)),
    staleTime: 20_000,
    refetchInterval: 60_000,
  })

  useEffect(() => {
    if (q.data) onLoaded?.(q.data)
  }, [q.data, onLoaded])

  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of q.data?.slots ?? []) map.set(s.local_day, [...(map.get(s.local_day) ?? []), s])
    return map
  }, [q.data])
  const days = useMemo(() => Array.from({ length: WINDOW }, (_, i) => addDays(from, i)).filter((d) => d <= horizonEnd), [from, horizonEnd])
  const [day, setDay] = useState<string | null>(value?.local_day ?? null)
  const firstAvailable = days.find((d) => (byDay.get(d)?.length ?? 0) > 0) ?? null
  const activeDay = day && days.includes(day) ? day : firstAvailable

  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [activeDay])

  const slots = activeDay ? (byDay.get(activeDay) ?? []) : []
  const groups = [
    { label: 'Утро', items: slots.filter((s) => s.local_time < '12:00') },
    { label: 'День', items: slots.filter((s) => s.local_time >= '12:00' && s.local_time < '17:00') },
    { label: 'Вечер', items: slots.filter((s) => s.local_time >= '17:00') },
  ].filter((g) => g.items.length > 0)

  return (
    <div className="grid gap-4">
      <div ref={stripRef} className="scroll-x -mx-4 flex gap-2 px-4 pb-1" role="group" aria-label="Дата">
        {q.isPending
          ? Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-[74px] w-14 shrink-0 rounded-xl" />)
          : days.map((d) => {
              const p = dayParts(d)
              const count = byDay.get(d)?.length ?? 0
              const selected = d === activeDay
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${p.weekday} ${p.day} ${p.monthLong}${count ? `, свободно ${count}` : ', нет времени'}`}
                  disabled={count === 0}
                  onClick={() => setDay(d)}
                  className={cn(
                    'pressable relative flex h-[74px] w-14 shrink-0 snap-start flex-col items-center justify-center gap-0.5 rounded-xl border text-center outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    selected ? 'border-transparent text-accent-fg' : 'border-line bg-surface text-fg',
                    count === 0 && 'opacity-35',
                  )}
                >
                  {selected && <m.span layoutId="day-pill" className="absolute inset-0 -z-0 rounded-xl bg-accent" transition={spring} aria-hidden />}
                  <span className={cn('relative text-[11px] uppercase', selected ? 'text-accent-fg/80' : 'text-fg-subtle')}>{p.weekday}</span>
                  <span className="relative text-lg font-semibold tabular">{p.day}</span>
                  <span className={cn('relative h-1 w-1 rounded-full', count > 0 ? (selected ? 'bg-accent-fg' : 'bg-success') : 'bg-transparent')} />
                </button>
              )
            })}
        {!q.isPending && addDays(from, WINDOW) <= horizonEnd && (
          <button type="button" onClick={() => setFrom(addDays(from, WINDOW))} className="pressable flex h-[74px] w-20 shrink-0 items-center justify-center rounded-xl border border-dashed border-line-strong text-center text-xs text-fg-muted">
            Дальше
          </button>
        )}
      </div>
      {from !== today(tz) && (
        <button type="button" className="justify-self-start text-sm text-accent-text" onClick={() => setFrom(today(tz))}>
          ← К ближайшим датам
        </button>
      )}

      {q.isError ? (
        <div className="grid justify-items-start gap-2 rounded-xl border border-line p-4">
          <p className="text-sm text-fg-muted">{errorMessage(q.error)}</p>
          <Button size="sm" variant="secondary" onClick={() => q.refetch()}>
            <RefreshCw /> Повторить
          </Button>
        </div>
      ) : q.isPending ? (
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : !firstAvailable ? (
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
          <CalendarClock className="mt-0.5 size-5 text-fg-muted" aria-hidden />
          <div className="grid gap-1 text-sm">
            <p className="font-medium">В эти дни свободного времени нет</p>
            <p className="text-fg-muted">Посмотрите следующие даты или позвоните в студию.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4" role="radiogroup" aria-label="Время">
          {groups.map((g) => (
            <div key={g.label} className="grid gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{g.label}</p>
              <div className="grid grid-cols-4 gap-2">
                {g.items.map((s) => {
                  const checked = value?.starts_at === s.starts_at
                  return (
                    <button
                      key={s.starts_at}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => onChange(s)}
                      className={cn(
                        'pressable h-11 rounded-lg border text-[15px] font-medium tabular outline-none focus-visible:ring-2 focus-visible:ring-focus',
                        checked ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface hover:border-line-strong',
                      )}
                    >
                      {s.local_time}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {value && q.data?.multi_day && (
            <p className="rounded-lg bg-info-subtle px-3 py-2 text-sm text-info">
              Работы займут несколько дней: автомобиль остаётся в студии, {span(value.starts_at, value.ends_at, tz)}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
