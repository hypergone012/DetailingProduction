import { BODY_TYPE_LABELS } from '@dp/core/tenant/constants'
import { CalendarDays, CarFront, Info, Wrench } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api/http'
import { device } from '@/lib/device'
import { dateLong, duration, money, span } from '@/lib/format'
import { actionKey, completeAction } from '@/lib/idempotency'
import { isValidPhone } from '@/lib/phone'
import { useTenant } from '@/tenant/TenantProvider'
import { priceFor, useInvalidateClient, useProfile } from '../../data'
import { PhoneInput } from '../../shared/PhoneInput'
import { useBookingFlow } from '../flow'
import { SheetFrame } from './SheetFrame'

const SLOT_GONE = new Set(['SLOT_UNAVAILABLE', 'TOO_SOON', 'TOO_FAR', 'OUTSIDE_WORKING_HOURS'])

export function ConfirmStep() {
  const { slug, api, service, tz, currency, locale, data } = useTenant()
  const flow = useBookingFlow()
  const invalidate = useInvalidateClient()
  const { profile } = useProfile()
  const id = useId()
  const saved = device.contact(slug)
  const [name, setName] = useState(saved?.name ?? profile?.profile.display_name ?? '')
  const [phone, setPhone] = useState(saved?.phone ?? profile?.profile.phone ?? '')
  const [email, setEmail] = useState(saved?.email ?? profile?.profile.email ?? '')
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; slotGone?: boolean } | null>(null)
  const s = service(flow.draft.serviceId)
  const slot = flow.draft.slot
  const vehicle = flow.draft.vehicle
  if (!s || !slot || !vehicle) return null

  const addons = s.addons.filter((a) => flow.draft.addonIds.includes(a.id))
  const base = priceFor(s, flow.bodyType)
  const total = base.price_cents + addons.reduce((n, a) => n + a.price_cents, 0)
  const work = base.duration_min + addons.reduce((n, a) => n + a.duration_min, 0)
  const phoneOk = isValidPhone(phone, locale)
  const nameOk = name.trim().length > 0
  const needsConfirmation = s.requires_confirmation

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!phoneOk || !nameOk || busy) return
    setBusy(true)
    setError(null)
    const scope = `book:${slug}`
    try {
      const r = await api.createBooking(
        {
          service_id: s.id,
          addon_ids: flow.draft.addonIds,
          starts_at: slot.starts_at,
          vehicle: vehicle.kind === 'saved' ? { id: vehicle.id } : vehicle.data,
          contact: { name: name.trim(), phone, email: email.trim() || null },
          note: note.trim(),
        },
        actionKey(scope),
      )
      completeAction(scope)
      device.setContact(slug, { name: name.trim(), phone, email: email.trim() })
      void invalidate()
      flow.finish(r)
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) completeAction(scope)
      const message = err instanceof ApiError ? err.message : 'Не удалось записаться. Попробуйте ещё раз.'
      setError({ message, slotGone: err instanceof ApiError && SLOT_GONE.has(err.code) })
      if (err instanceof ApiError && SLOT_GONE.has(err.code)) void invalidate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="contents">
      <SheetFrame
        title="Подтверждение"
        step={4}
        onBack={flow.back}
        onClose={flow.close}
        footer={
          <Button type="submit" size="lg" block loading={busy}>
            {needsConfirmation ? 'Отправить заявку' : 'Записаться'} · {money(total, currency, locale)}
          </Button>
        }
      >
        <div className="grid gap-5">
          <div className="grid gap-3 rounded-2xl border border-line bg-bg-elevated p-4">
            <Row icon={<Wrench />} title={s.name} text={s.multi_day ? `Работы несколько дней · ${duration(work)} рабочего времени` : duration(work)} />
            <Row
              icon={<CarFront />}
              title={vehicle.kind === 'saved' ? vehicle.label : `${vehicle.data.make} ${vehicle.data.model}`}
              text={flow.bodyType ? BODY_TYPE_LABELS[flow.bodyType] : ''}
            />
            <Row icon={<CalendarDays />} title={dateLong(slot.starts_at, tz, locale)} text={span(slot.starts_at, slot.ends_at, tz, locale)} />
            <div className="mt-1 grid gap-1.5 border-t border-line pt-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-fg-muted">{s.name}</span>
                <span className="tabular">{money(base.price_cents, currency, locale)}</span>
              </div>
              {addons.map((a) => (
                <div key={a.id} className="flex justify-between gap-3">
                  <span className="text-fg-muted">{a.name}</span>
                  <span className="tabular">{money(a.price_cents, currency, locale)}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between gap-3 text-base font-semibold">
                <span>Итого</span>
                <span className="tabular">{money(total, currency, locale)}</span>
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <Field id={`${id}-name`} label="Имя" error={touched && !nameOk ? 'Как к вам обращаться?' : null}>
              <Input id={`${id}-name`} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={touched && !nameOk} />
            </Field>
            <Field id={`${id}-phone`} label="Телефон" hint="Студия позвонит, только если что-то изменится" error={touched && !phoneOk ? 'Проверьте номер телефона' : null}>
              <PhoneInput id={`${id}-phone`} value={phone} onValueChange={setPhone} locale={locale} aria-invalid={touched && !phoneOk} />
            </Field>
            <Field id={`${id}-email`} label="Email (необязательно)">
              <Input id={`${id}-email`} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field id={`${id}-note`} label="Комментарий">
              <Textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Что важно знать мастеру" />
            </Field>
          </div>

          <div className="grid gap-2 rounded-xl bg-sunken p-3 text-sm text-fg-muted">
            <p className="flex gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {needsConfirmation ? 'Студия подтвердит запись — придёт уведомление, если вы их включите. ' : ''}
                Перенести или отменить онлайн можно не позднее чем за {data.policy.cancel_cutoff_hours} ч до визита.
              </span>
            </p>
            {s.prep_notes.map((n) => (
              <p key={n} className="pl-6">
                {n}
              </p>
            ))}
            <p className="pl-6 text-xs">Имя и телефон используются только для этой записи и связи со студией.</p>
          </div>

          {error && (
            <div role="alert" className="grid gap-2 rounded-xl border border-danger/40 bg-danger-subtle p-3 text-sm">
              <p className="font-medium text-danger">{error.message}</p>
              {error.slotGone && (
                <Button type="button" variant="secondary" size="sm" onClick={() => (flow.update({ slot: null }), flow.back())}>
                  Выбрать другое время
                </Button>
              )}
            </div>
          )}
        </div>
      </SheetFrame>
    </form>
  )
}

function Row({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted [&_svg]:size-[18px]">{icon}</span>
      <div className="grid min-w-0">
        <span className="font-medium first-letter:uppercase">{title}</span>
        {text && <span className="text-sm text-fg-muted">{text}</span>}
      </div>
    </div>
  )
}
