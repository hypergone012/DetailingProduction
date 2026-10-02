import { zonedIso } from '@dp/core/time/zoned'
import { useQuery } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { SheetFrame } from '@/components/SheetFrame'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { errorMessage } from '@/lib/api/http'
import { dateLong, dayKey, span, today } from '@/lib/format'
import { rpc } from '../api/client'
import type { OwnerBooking, OwnerSlot } from '../api/types'
import { ownerKeys, useBooking, useCatalog, useOwner, useOwnerMutation } from '../data'
import { ResourcePicker } from '../shared/ResourcePicker'
import { useSheets } from '../shared/sheets'
import { DayStrip, SlotTimes, slotsByDay } from '../shared/SlotGrid'
import { DateInput, TimeInput } from '../shared/TimeField'

const DAYS = 14

export function MoveSheet({ id }: { id: string }) {
  const sheets = useSheets()
  const q = useBooking(id)
  return (
    <SheetFrame title="Перенос записи" onBack={() => sheets.replace({ booking: id })} onClose={sheets.close}>
      {q.data ? <MoveBody b={q.data} /> : q.isError ? <p className="px-4 text-sm text-danger">{errorMessage(q.error)}</p> : <Skeleton className="mx-4 h-64 rounded-2xl" />}
    </SheetFrame>
  )
}

function MoveBody({ b }: { b: OwnerBooking }) {
  const { tenantId, tz, locale } = useOwner()
  const sheets = useSheets()
  const id = useId()
  const catalog = useCatalog()
  const from = today(tz)
  const [day, setDay] = useState(() => {
    const d = dayKey(b.starts_at, tz)
    return d < from ? from : d
  })
  const [slot, setSlot] = useState<OwnerSlot | null>(null)
  const [manual, setManual] = useState(false)
  const [manualDay, setManualDay] = useState(day)
  const [manualTime, setManualTime] = useState('')
  const [outside, setOutside] = useState(false)
  const [resource, setResource] = useState<string>('auto')

  // Free times for THIS booking's snapshot (duration, buffers), ignoring its own interval.
  const avail = useQuery({
    queryKey: ownerKeys.availability(tenantId, `move:${b.id}:${from}`),
    queryFn: () => rpc<{ slots: OwnerSlot[] }>('owner_reschedule_availability', { p_booking: b.id, p_from_day: from, p_days: DAYS }),
  })
  const byDay = useMemo(() => slotsByDay(avail.data?.slots ?? []), [avail.data])
  const counts = useMemo(() => Object.fromEntries(Object.entries(byDay).map(([d, s]) => [d, s.length])), [byDay])
  const service = catalog.data?.services.find((s) => s.id === b.service.id)
  const suitable = (catalog.data?.resources ?? []).filter((r) => r.active && (!service || service.resource_types.includes(r.type)))

  const move = useOwnerMutation(() =>
    rpc('owner_reschedule_booking', {
      p_booking: b.id,
      p_starts_at: manual ? zonedIso(manualDay, manualTime, tz) : slot!.starts_at,
      p_resource_id: resource === 'auto' ? null : resource,
      p_allow_outside_hours: manual && outside,
    }),
  )
  const ready = manual ? Boolean(manualDay && /^\d{2}:\d{2}$/.test(manualTime)) : Boolean(slot)

  return (
    <div className="grid gap-5 px-4 pb-8">
      <p className="rounded-xl bg-sunken p-3 text-sm">
        Сейчас: <b className="font-semibold first-letter:uppercase">{dateLong(b.starts_at, tz, locale)}</b>, {span(b.starts_at, b.ends_at, tz, locale)}
        {b.resource ? ` · ${b.resource.name}` : ''}. Длительность и цена сохраняются.
      </p>
      {!manual ? (
        <>
          <DayStrip from={from} days={DAYS} value={day} onChange={(d) => (setDay(d), setSlot(null))} counts={counts} />
          {avail.isPending ? <Skeleton className="h-32 rounded-xl" /> : avail.isError ? <p className="text-sm text-danger">{errorMessage(avail.error)}</p> : <SlotTimes slots={byDay[day] ?? []} value={slot?.starts_at ?? null} onChange={setSlot} />}
          <Button variant="ghost" className="justify-self-start" onClick={() => (setManual(true), setManualDay(day))}>
            Указать время вручную
          </Button>
        </>
      ) : (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-day`} label="Дата">
              <DateInput id={`${id}-day`} value={manualDay} onChange={(e) => setManualDay(e.target.value)} />
            </Field>
            <Field id={`${id}-time`} label="Начало">
              <TimeInput id={`${id}-time`} value={manualTime} onChange={(e) => setManualTime(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={outside} onCheckedChange={setOutside} /> Разрешить вне рабочего времени
          </label>
          <p className="text-xs text-fg-subtle">Пересечения с другими записями и блокировками сервер не допустит в любом случае.</p>
          <Button variant="ghost" className="justify-self-start" onClick={() => setManual(false)}>
            Выбрать из свободного времени
          </Button>
        </div>
      )}
      <ResourcePicker resources={suitable} value={resource} onChange={setResource} />
      {move.error && <p role="alert" className="text-sm text-danger">{errorMessage(move.error)}</p>}
      <Button size="lg" block disabled={!ready} loading={move.isPending} onClick={() => move.mutate(undefined, { onSuccess: () => sheets.replace({ booking: b.id }) })}>
        Перенести
      </Button>
    </div>
  )
}
