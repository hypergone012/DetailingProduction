import { Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { ScreenHeader } from '@/components/ScreenHeader'
import { Card, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { errorMessage } from '@/lib/api/http'
import { dateWithYear, today } from '@/lib/format'
import { tenantQueryKey } from '@/tenant/TenantProvider'
import { rpc } from '../api/client'
import type { HoursRow, ResourceRow } from '../api/types'
import { useCatalog, useOwner, useOwnerMutation, useSchedule } from '../data'
import { newEntityKey } from '../shared/keys'
import { dayNoon } from '../shared/SlotGrid'
import { DateInput, TimeInput } from '../shared/TimeField'

const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']

interface Window {
  opens: string
  closes: string
}

export function ScheduleScreen() {
  const { slug } = useOwner()
  return (
    <>
      <ScreenHeader title="Расписание и ресурсы" parent={`/s/${slug}/owner/settings`} wide />
      <div className="mx-auto grid max-w-3xl gap-8 px-4 pb-10">
        <WeeklyHours />
        <Exceptions />
        <Resources />
      </div>
    </>
  )
}

function toWindows(hours: HoursRow[]): Window[][] {
  return Array.from({ length: 7 }, (_, i) => hours.filter((h) => h.weekday === i + 1).map((h) => ({ opens: h.opens.slice(0, 5), closes: h.closes.slice(0, 5) })))
}

function WeeklyHours() {
  const q = useSchedule()
  if (!q.data) return <Skeleton className="h-80 rounded-2xl" />
  // Re-mount the editor when the saved schedule changes (after saving or a republish).
  const saved = toWindows(q.data.hours)
  return <WeeklyHoursEditor key={JSON.stringify(saved)} saved={saved} />
}

function WeeklyHoursEditor({ saved }: { saved: Window[][] }) {
  const { tenantId, slug, isOwner } = useOwner()
  const [week, setWeek] = useState<Window[][]>(saved)
  const save = useOwnerMutation(
    () =>
      rpc('owner_set_hours', {
        p_tenant: tenantId,
        p_hours: week.flatMap((ws, i) => ws.map((w) => ({ weekday: i + 1, opens: w.opens, closes: w.closes }))),
      }),
    [tenantQueryKey(slug)],
  )
  const dirty = JSON.stringify(week) !== JSON.stringify(saved)
  const set = (day: number, ws: Window[]) => setWeek((w) => w.map((x, i) => (i === day ? ws : x)))
  return (
    <Section title="Рабочие часы">
      <Card className="grid divide-y divide-line">
        {week.map((ws, day) => (
          <div key={day} className="grid gap-2 p-3 sm:grid-cols-[150px_1fr] sm:items-start">
            <label className="flex items-center gap-3 text-[15px]">
              <Switch disabled={!isOwner} checked={ws.length > 0} onCheckedChange={(on) => set(day, on ? [{ opens: '10:00', closes: '20:00' }] : [])} aria-label={`${WEEKDAYS[day]} — рабочий день`} />
              {WEEKDAYS[day]}
            </label>
            {ws.length === 0 ? (
              <span className="text-sm text-fg-muted sm:pt-2">Выходной</span>
            ) : (
              <div className="grid gap-2">
                {ws.map((w, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <TimeInput disabled={!isOwner} aria-label="Открытие" className="h-10" value={w.opens} onChange={(e) => set(day, ws.map((x, k) => (k === j ? { ...x, opens: e.target.value } : x)))} />
                    <span className="text-fg-subtle">–</span>
                    <TimeInput disabled={!isOwner} aria-label="Закрытие" className="h-10" value={w.closes} onChange={(e) => set(day, ws.map((x, k) => (k === j ? { ...x, closes: e.target.value } : x)))} />
                    {isOwner && ws.length > 1 && (
                      <Button variant="ghost" size="icon-sm" aria-label="Удалить интервал" onClick={() => set(day, ws.filter((_, k) => k !== j))}>
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                ))}
                {isOwner && (
                  <Button variant="link" size="sm" className="justify-self-start" onClick={() => set(day, [...ws, { opens: '14:00', closes: '18:00' }])}>
                    <Plus /> Перерыв / второй интервал
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </Card>
      <p className="text-xs text-fg-subtle">Закрытие раньше открытия означает работу через полночь. Существующие записи не переносятся автоматически.</p>
      {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
      {isOwner && dirty && (
        <Button className="justify-self-start" loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Сохранить часы
        </Button>
      )}
      {!isOwner && <p className="text-xs text-fg-subtle">Менять рабочие часы может только владелец.</p>}
    </Section>
  )
}

function Exceptions() {
  const { tenantId, tz, locale, slug, canManage } = useOwner()
  const q = useSchedule()
  const id = useId()
  const [day, setDay] = useState('')
  const [closed, setClosed] = useState(true)
  const [opens, setOpens] = useState('10:00')
  const [closes, setCloses] = useState('16:00')
  const [note, setNote] = useState('')
  const add = useOwnerMutation(
    () => rpc('owner_save_exception', { p_tenant: tenantId, p_exception: { day, closed, opens: closed ? null : opens, closes: closed ? null : closes, note: note.trim() } }),
    [tenantQueryKey(slug)],
  )
  const remove = useOwnerMutation((exceptionId: string) => rpc('owner_delete_exception', { p_exception: exceptionId }), [tenantQueryKey(slug)])
  return (
    <Section title="Праздники и особые дни">
      {(q.data?.exceptions ?? []).length > 0 && (
        <Card className="grid divide-y divide-line">
          {q.data!.exceptions.map((x) => (
            <div key={x.id} className="flex items-center gap-3 p-3">
              <div className="grid min-w-0 flex-1">
                <span className="font-medium">{dateWithYear(dayNoon(x.day, tz), tz, locale)}</span>
                <span className="text-sm text-fg-muted">
                  {x.closed ? 'Выходной' : `${x.opens?.slice(0, 5)}–${x.closes?.slice(0, 5)}`}
                  {x.note ? ` · ${x.note}` : ''}
                </span>
              </div>
              {canManage && (
                <Button variant="ghost" size="icon-sm" aria-label="Удалить" loading={remove.isPending && remove.variables === x.id} onClick={() => remove.mutate(x.id)}>
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
      {canManage && (
        <Card className="grid gap-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-day`} label="Дата">
              <DateInput id={`${id}-day`} min={today(tz)} value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field id={`${id}-note`} label="Подпись">
              <Input id={`${id}-note`} value={note} maxLength={120} placeholder="Новый год" onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={closed} onCheckedChange={setClosed} /> Закрыто весь день
          </label>
          {!closed && (
            <div className="flex items-center gap-2">
              <TimeInput aria-label="Открытие" value={opens} onChange={(e) => setOpens(e.target.value)} />
              <span className="text-fg-subtle">–</span>
              <TimeInput aria-label="Закрытие" value={closes} onChange={(e) => setCloses(e.target.value)} />
            </div>
          )}
          {add.error && <p role="alert" className="text-sm text-danger">{errorMessage(add.error)}</p>}
          <Button className="justify-self-start" disabled={!day} loading={add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => (setDay(''), setNote('')) })}>
            <Plus /> Добавить день
          </Button>
        </Card>
      )}
    </Section>
  )
}

function Resources() {
  const { tenantId, isOwner } = useOwner()
  const catalog = useCatalog()
  const id = useId()
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const save = useOwnerMutation((r: Partial<ResourceRow>) => rpc('owner_save_resource', { p_tenant: tenantId, p_resource: r }))
  const resources = catalog.data?.resources ?? []
  const types = [...new Set(resources.map((r) => r.type))]
  return (
    <Section title="Боксы и посты">
      <p className="-mt-1 px-1 text-sm text-fg-muted">Ресурс — место, где одновременно обслуживается один автомобиль. У каждого своя дорожка в календаре.</p>
      <Card className="grid divide-y divide-line">
        {resources.map((r) => (
          <div key={r.id} className="flex items-center gap-3 p-3">
            <div className="grid min-w-0 flex-1">
              <span className="font-medium">{r.name}</span>
              <span className="text-xs text-fg-subtle">тип: {r.type}</span>
            </div>
            <Switch disabled={!isOwner || save.isPending} checked={r.active} onCheckedChange={(active) => save.mutate({ id: r.id, active })} aria-label={`${r.name} — активен`} />
          </div>
        ))}
      </Card>
      {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
      {isOwner ? (
        <Card className="grid gap-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-name`} label="Название">
              <Input id={`${id}-name`} value={name} maxLength={60} placeholder="Бокс 3" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field id={`${id}-type`} label="Тип" hint={types.length ? `Есть: ${types.join(', ')}` : 'Например, detail_bay'}>
              <Input id={`${id}-type`} value={type} maxLength={40} list={`${id}-types`} onChange={(e) => setType(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
              <datalist id={`${id}-types`}>
                {types.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
          </div>
          <Button
            className="justify-self-start"
            disabled={!name.trim() || !/^[a-z][a-z0-9_]*$/.test(type)}
            loading={save.isPending}
            onClick={() => save.mutate({ key: newEntityKey(name), name: name.trim(), type, sort_order: resources.length }, { onSuccess: () => (setName(''), setType('')) })}
          >
            <Plus /> Добавить ресурс
          </Button>
        </Card>
      ) : (
        <p className="text-xs text-fg-subtle">Добавлять ресурсы может только владелец.</p>
      )}
    </Section>
  )
}
