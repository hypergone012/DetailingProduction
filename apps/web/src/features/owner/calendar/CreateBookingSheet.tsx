import { zonedIso } from '@dp/core/time/zoned'
import type { BodyType } from '@dp/core/tenant/constants'
import { BODY_TYPE_LABELS } from '@dp/core/tenant/constants'
import { useQuery } from '@tanstack/react-query'
import { Check, Search, UserPlus, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { BodyTypePicker } from '@/components/BodyTypePicker'
import { PhoneInput } from '@/components/PhoneInput'
import { SheetFrame } from '@/components/SheetFrame'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api/http'
import { duration, money, phonePretty, today } from '@/lib/format'
import { isValidPhone } from '@/lib/phone'
import { cn } from '@/lib/utils'
import { rpc, toE164 } from '../api/client'
import type { CustomerRow, OwnerSlot } from '../api/types'
import { ownerKeys, useCatalog, useCustomer, useCustomers, useOwner, useOwnerMutation } from '../data'
import { ResourcePicker } from '../shared/ResourcePicker'
import { useSheets } from '../shared/sheets'
import { SlotTimes } from '../shared/SlotGrid'
import { DateInput, TimeInput } from '../shared/TimeField'

type VehicleChoice = { kind: 'saved'; id: string; body: BodyType } | { kind: 'new' } | { kind: 'none' }

export function CreateBookingSheet() {
  const sheets = useSheets()
  return (
    <SheetFrame title="Новая запись" onClose={sheets.close}>
      <KindSwitch current="booking" />
      <CreateBody />
    </SheetFrame>
  )
}

/** Booking or block at the same place and time (both start from a tap in the calendar). */
export function KindSwitch({ current }: { current: 'booking' | 'block' }) {
  const sheets = useSheets()
  const { canManage } = useOwner()
  if (!canManage) return null
  return (
    <div className="mx-4 mb-4 grid grid-cols-2 gap-1 rounded-xl border border-line bg-sunken p-1 text-sm font-medium" role="tablist">
      {(['booking', 'block'] as const).map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={current === k}
          className={cn('h-9 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus', current === k ? 'bg-surface text-fg shadow-card' : 'text-fg-muted')}
          onClick={() => current !== k && sheets.replace({ new: k, day: sheets.day, time: sheets.time, resource: sheets.resource, customer: sheets.customer })}
        >
          {k === 'booking' ? 'Запись' : 'Блокировка'}
        </button>
      ))}
    </div>
  )
}

function CreateBody() {
  const { tenantId, tz, locale, currency } = useOwner()
  const sheets = useSheets()
  const id = useId()
  const catalog = useCatalog()

  const [customer, setCustomer] = useState<CustomerRow | null>(null)
  const [customerId, setCustomerId] = useState<string | null>(sheets.customer)
  const [newCustomer, setNewCustomer] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [vehicle, setVehicle] = useState<VehicleChoice>({ kind: 'none' })
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [body, setBody] = useState<BodyType | null>(null)
  const [plate, setPlate] = useState('')
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [addonIds, setAddonIds] = useState<string[]>([])
  const [day, setDay] = useState(sheets.day ?? today(tz))
  const [manual, setManual] = useState(Boolean(sheets.time))
  const [manualTime, setManualTime] = useState(sheets.time ?? '')
  const [slot, setSlot] = useState<OwnerSlot | null>(null)
  const [outside, setOutside] = useState(false)
  const [resource, setResource] = useState(sheets.resource ?? 'auto')
  const [confirmNow, setConfirmNow] = useState(true)
  const [note, setNote] = useState('')
  const [internal, setInternal] = useState('')
  const [touched, setTouched] = useState(false)
  // One key per opened form: a retry after a dropped connection returns the same booking.
  const [idemKey] = useState(() => crypto.randomUUID())

  const detail = useCustomer(customerId ?? '')
  const chosen = customerId ? (detail.data?.customer ?? customer) : null
  const services = (catalog.data?.services ?? []).filter((s) => s.active)
  const service = services.find((s) => s.id === serviceId)
  const bodyType: BodyType | null = vehicle.kind === 'saved' ? vehicle.body : vehicle.kind === 'new' ? body : null
  const suitable = (catalog.data?.resources ?? []).filter((r) => r.active && (!service || service.resource_types.includes(r.type)))

  const avail = useQuery({
    queryKey: ownerKeys.availability(tenantId, `new:${serviceId}:${bodyType}:${addonIds.join(',')}:${day}`),
    enabled: Boolean(serviceId && day),
    queryFn: () =>
      rpc<{ price_cents: number; work_minutes: number; items: { name: string; price_cents: number }[]; slots: OwnerSlot[] }>('owner_availability', {
        p_tenant: tenantId,
        p_service_id: serviceId,
        p_body_type: bodyType,
        p_addon_ids: addonIds,
        p_from_day: day,
        p_days: 1,
      }),
  })
  const manualIsFree = manual && avail.data?.slots.some((s) => s.local_time === manualTime)

  const customerOk = chosen ? true : newCustomer && name.trim().length > 0 && isValidPhone(phone, locale)
  const vehicleOk = vehicle.kind !== 'new' || (make.trim() && model.trim() && body)
  const timeOk = manual ? /^\d{2}:\d{2}$/.test(manualTime) : Boolean(slot)
  const valid = customerOk && vehicleOk && service && timeOk

  const create = useOwnerMutation(() =>
    rpc<{ id: string }>('owner_create_booking', {
      p_tenant: tenantId,
      p_payload: {
        customer: chosen ? { id: chosen.id } : { name: name.trim(), phone: toE164(phone), email: email.trim() || null },
        vehicle:
          vehicle.kind === 'saved'
            ? { id: vehicle.id }
            : vehicle.kind === 'new'
              ? { make: make.trim(), model: model.trim(), body_type: body, plate: plate.trim() || null }
              : null,
        service_id: serviceId,
        addon_ids: addonIds,
        starts_at: manual ? zonedIso(day, manualTime, tz) : slot!.starts_at,
        resource_id: resource === 'auto' ? null : resource,
        allow_outside_hours: manual && outside,
        status: confirmNow ? 'confirmed' : 'pending',
        note: note.trim(),
        internal_note: internal.trim(),
        idempotency_key: idemKey,
      },
    }),
  )

  const submit = () => {
    setTouched(true)
    if (!valid) return
    create.mutate(undefined, { onSuccess: (b) => sheets.replace({ booking: b.id }) })
  }

  return (
    <div className="grid gap-6 px-4 pb-8">
      <section className="grid gap-3">
        <Label>Клиент</Label>
        {chosen ? (
          <div className="flex items-center gap-3 rounded-xl border border-accent-text bg-accent-subtle p-3">
            <div className="grid min-w-0 flex-1">
              <span className="truncate font-medium">{chosen.name}</span>
              <span className="text-sm text-fg-muted">
                {phonePretty(chosen.phone_e164)} · визитов {chosen.completed_count}
              </span>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Выбрать другого клиента" onClick={() => (setCustomerId(null), setCustomer(null), setVehicle({ kind: 'none' }))}>
              <X />
            </Button>
          </div>
        ) : newCustomer ? (
          <div className="grid gap-3">
            <Field id={`${id}-name`} label="Имя" error={touched && !name.trim() ? 'Как зовут клиента?' : null}>
              <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </Field>
            <Field id={`${id}-phone`} label="Телефон" error={touched && !isValidPhone(phone, locale) ? 'Проверьте номер' : null}>
              <PhoneInput id={`${id}-phone`} value={phone} onValueChange={setPhone} locale={locale} />
            </Field>
            <Field id={`${id}-email`} label="Email (необязательно)">
              <Input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <p className="text-xs text-fg-subtle">Если клиент с этим телефоном уже есть, запись привяжется к нему.</p>
            <Button variant="ghost" className="justify-self-start" onClick={() => setNewCustomer(false)}>
              <Search /> Найти существующего
            </Button>
          </div>
        ) : (
          <CustomerSearch onPick={(c) => (setCustomer(c), setCustomerId(c.id), setVehicle({ kind: 'none' }))} onNew={() => setNewCustomer(true)} invalid={touched} />
        )}
      </section>

      <section className="grid gap-3">
        <Label>Автомобиль</Label>
        <div className="grid gap-2" role="radiogroup" aria-label="Автомобиль">
          {(detail.data?.vehicles ?? []).map((v) => (
            <Choice key={v.id} checked={vehicle.kind === 'saved' && vehicle.id === v.id} onClick={() => setVehicle({ kind: 'saved', id: v.id, body: v.body_type })}>
              {v.make} {v.model}
              <span className="text-fg-muted">
                {' '}
                · {BODY_TYPE_LABELS[v.body_type]}
                {v.plate ? ` · ${v.plate}` : ''}
              </span>
            </Choice>
          ))}
          <Choice checked={vehicle.kind === 'new'} onClick={() => setVehicle({ kind: 'new' })}>
            Новый автомобиль
          </Choice>
          <Choice checked={vehicle.kind === 'none'} onClick={() => setVehicle({ kind: 'none' })}>
            Без автомобиля <span className="text-fg-muted">· базовая цена</span>
          </Choice>
        </div>
        {vehicle.kind === 'new' && (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field id={`${id}-make`} label="Марка" error={touched && !make.trim() ? 'Укажите марку' : null}>
                <Input id={`${id}-make`} value={make} onChange={(e) => setMake(e.target.value)} />
              </Field>
              <Field id={`${id}-model`} label="Модель" error={touched && !model.trim() ? 'Укажите модель' : null}>
                <Input id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)} />
              </Field>
            </div>
            <BodyTypePicker id={`${id}-body`} value={body} onChange={setBody} allowed={service?.allowed_body_types ?? null} />
            {touched && !body && <p className="text-sm text-danger">Выберите тип кузова</p>}
            <Field id={`${id}-plate`} label="Госномер (необязательно)">
              <Input id={`${id}-plate`} value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
            </Field>
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <Field id={`${id}-service`} label="Услуга" error={touched && !service ? 'Выберите услугу' : null}>
          {catalog.isPending ? (
            <Skeleton className="h-12 rounded-lg" />
          ) : (
            <Select value={serviceId ?? ''} onValueChange={(v) => (setServiceId(v), setAddonIds([]), setSlot(null))}>
              <SelectTrigger id={`${id}-service`}>
                <SelectValue placeholder="Выберите услугу" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {!s.bookable_online ? ' (только студия)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        {service && service.service_addons.filter((a) => a.active).length > 0 && (
          <div className="grid gap-2">
            {service.service_addons
              .filter((a) => a.active)
              .map((a) => {
                const on = addonIds.includes(a.id)
                return (
                  <Choice key={a.id} checked={on} onClick={() => setAddonIds((ids) => (on ? ids.filter((x) => x !== a.id) : [...ids, a.id]))} multi>
                    {a.name} <span className="text-fg-muted">· +{money(a.price_cents, currency, locale)}</span>
                  </Choice>
                )
              })}
          </div>
        )}
      </section>

      {service && (
        <section className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-day`} label="Дата">
              <DateInput id={`${id}-day`} value={day} onChange={(e) => e.target.value && (setDay(e.target.value), setSlot(null))} />
            </Field>
            {manual && (
              <Field id={`${id}-time`} label="Начало" error={touched && !timeOk ? 'Укажите время' : null}>
                <TimeInput id={`${id}-time`} value={manualTime} onChange={(e) => setManualTime(e.target.value)} />
              </Field>
            )}
          </div>
          {manual ? (
            <>
              {avail.data && manualTime && (
                <p className={cn('text-sm', manualIsFree ? 'text-success' : 'text-warning')}>
                  {manualIsFree ? 'Это время свободно по расписанию.' : 'Это время не в списке свободного: проверьте занятость или разрешите запись вне рабочего времени.'}
                </p>
              )}
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={outside} onCheckedChange={setOutside} /> Разрешить вне рабочего времени
              </label>
              <Button variant="ghost" className="justify-self-start" onClick={() => setManual(false)}>
                Выбрать из свободного времени
              </Button>
            </>
          ) : (
            <>
              {avail.isPending ? <Skeleton className="h-24 rounded-xl" /> : avail.isError ? <p className="text-sm text-danger">{errorMessage(avail.error)}</p> : <SlotTimes slots={avail.data.slots} value={slot?.starts_at ?? null} onChange={setSlot} />}
              {touched && !slot && <p className="text-sm text-danger">Выберите время</p>}
              <Button variant="ghost" className="justify-self-start" onClick={() => setManual(true)}>
                Указать время вручную
              </Button>
            </>
          )}
          <ResourcePicker resources={suitable} value={resource} onChange={setResource} />
        </section>
      )}

      <section className="grid gap-3">
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={confirmNow} onCheckedChange={setConfirmNow} /> Сразу подтвердить
        </label>
        <Field id={`${id}-note`} label="Пожелания клиента">
          <Textarea id={`${id}-note`} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field id={`${id}-internal`} label="Заметка студии" hint="Видна только сотрудникам">
          <Textarea id={`${id}-internal`} value={internal} maxLength={4000} onChange={(e) => setInternal(e.target.value)} />
        </Field>
      </section>

      {avail.data && (
        <div className="flex items-baseline justify-between gap-3 rounded-xl bg-sunken p-3 text-sm">
          <span className="text-fg-muted">
            {service?.multi_day ? 'Несколько дней' : duration(avail.data.work_minutes)}
            {bodyType ? ` · ${BODY_TYPE_LABELS[bodyType]}` : ''}
          </span>
          <span className="text-lg font-semibold tabular text-fg">{money(avail.data.price_cents, currency, locale)}</span>
        </div>
      )}
      {create.error && <p role="alert" className="text-sm text-danger">{errorMessage(create.error)}</p>}
      <Button size="lg" block loading={create.isPending} onClick={submit}>
        Создать запись
      </Button>
    </div>
  )
}

function Choice({ checked, onClick, children, multi = false }: { checked: boolean; onClick: () => void; children: React.ReactNode; multi?: boolean }) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        'pressable flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-left text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-focus',
        checked ? 'border-accent-text bg-accent-subtle' : 'border-line bg-bg-elevated',
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {checked && <Check className="size-4 shrink-0 text-accent-text" aria-hidden />}
    </button>
  )
}

function CustomerSearch({ onPick, onNew, invalid }: { onPick: (c: CustomerRow) => void; onNew: () => void; invalid: boolean }) {
  const id = useId()
  const [q, setQ] = useState('')
  const term = q.trim()
  const results = useCustomers(term, term.length >= 2)
  const list = useMemo(() => (term.length >= 2 ? (results.data ?? []).slice(0, 6) : []), [results.data, term])
  return (
    <div className="grid gap-2">
      <Input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или телефон" aria-label="Поиск клиента" autoComplete="off" />
      {list.map((c) => (
        <button key={c.id} type="button" onClick={() => onPick(c)} className="pressable flex items-center gap-3 rounded-xl border border-line bg-bg-elevated px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <span className="grid min-w-0 flex-1">
            <span className="truncate font-medium">{c.name}</span>
            <span className="text-sm text-fg-muted">
              {phonePretty(c.phone_e164)} · визитов {c.completed_count}
            </span>
          </span>
        </button>
      ))}
      {term.length >= 2 && !results.isFetching && list.length === 0 && <p className="text-sm text-fg-muted">Не найдено.</p>}
      {invalid && <p className="text-sm text-danger">Выберите клиента или добавьте нового</p>}
      <Button variant="secondary" className="justify-self-start" onClick={onNew}>
        <UserPlus /> Новый клиент
      </Button>
    </div>
  )
}
