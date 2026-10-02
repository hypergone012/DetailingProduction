import { BottomSheet } from '@astryxdesign/core/BottomSheet'
import { BODY_TYPE_LABELS } from '@dp/core/tenant/constants'
import { CalendarPlus, CarFront, Mail, Pencil, Phone, Plus } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { StatusScreen } from '@/app/StatusScreen'
import { ScreenHeader } from '@/components/ScreenHeader'
import { Card, Section } from '@/components/Section'
import { SheetFrame } from '@/components/SheetFrame'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { VehicleForm, type VehicleFormValue } from '@/components/VehicleForm'
import { errorMessage } from '@/lib/api/http'
import { money, phonePretty, when } from '@/lib/format'
import { cn } from '@/lib/utils'
import { rpc } from '../api/client'
import type { VehicleRow } from '../api/types'
import { useCustomer, useOwner, useOwnerMutation } from '../data'
import { PAYMENT_METHOD_LABEL } from '../shared/labels'
import { Stat } from '../shared/Row'
import { useSheets } from '../shared/sheets'
import { CustomerForm } from './CustomerForm'

export function CustomerScreen() {
  const { id = '' } = useParams()
  const { slug, tz, locale, currency, canManage, tenantId } = useOwner()
  const sheets = useSheets()
  const q = useCustomer(id)
  const [editing, setEditing] = useState(false)
  const [vehicle, setVehicle] = useState<VehicleRow | 'new' | null>(null)
  const saveVehicle = useOwnerMutation((v: VehicleFormValue & { owner_notes: string }) =>
    rpc('owner_save_vehicle', { p_tenant: tenantId, p_vehicle: { ...v, customer_id: id, ...(vehicle && vehicle !== 'new' ? { id: vehicle.id } : {}) } }),
  )

  if (q.isPending) return <Skeleton className="m-4 h-72 rounded-2xl" />
  if (q.isError) return <StatusScreen title="Не удалось загрузить клиента" text={errorMessage(q.error)} />
  if (!q.data) return <StatusScreen title="Клиент не найден" text="Возможно, он из другой студии или был удалён." />
  const { customer: c, vehicles, bookings, payments } = q.data
  const vehicleName = new Map(vehicles.map((v) => [v.id, `${v.make} ${v.model}`]))

  return (
    <>
      <ScreenHeader
        title={c.name}
        parent={`/s/${slug}/owner/customers`}
        wide
        actions={
          canManage && (
            <Button variant="ghost" size="icon" aria-label="Изменить клиента" onClick={() => setEditing(true)}>
              <Pencil />
            </Button>
          )
        }
      />
      <div className="mx-auto grid max-w-3xl gap-6 px-4 pb-10">
        <div className="flex flex-wrap gap-2">
          {c.phone_e164 && (
            <Button variant="secondary" size="sm" asChild>
              <a href={`tel:${c.phone_e164}`}>
                <Phone /> {phonePretty(c.phone_e164)}
              </a>
            </Button>
          )}
          {c.email && (
            <Button variant="secondary" size="sm" asChild>
              <a href={`mailto:${c.email}`}>
                <Mail /> {c.email}
              </a>
            </Button>
          )}
          {canManage && (
            <Button size="sm" onClick={() => sheets.open({ new: 'booking', customer: c.id })}>
              <CalendarPlus /> Записать
            </Button>
          )}
          {c.is_demo && <Badge tone="warning">Демо-клиент</Badge>}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Визитов" value={c.completed_count} />
          <Stat label="Отмен" value={c.cancelled_count} />
          <Stat label="Следующий" value={c.next_visit_at ? when(c.next_visit_at, tz, locale) : '—'} />
          {payments !== null && <Stat label="Оплачено всего" value={money(c.total_paid_cents, currency, locale)} />}
        </div>

        {c.owner_notes && (
          <Card className="p-4 text-sm">
            <p className="mb-1 text-xs text-fg-subtle">Заметки</p>
            <p className="whitespace-pre-wrap">{c.owner_notes}</p>
          </Card>
        )}

        <Section
          title="Автомобили"
          action={
            canManage && (
              <Button variant="link" size="sm" onClick={() => setVehicle('new')}>
                <Plus /> Добавить
              </Button>
            )
          }
        >
          {vehicles.length === 0 ? (
            <p className="rounded-xl bg-sunken p-4 text-sm text-fg-muted">Автомобилей нет.</p>
          ) : (
            <div className="grid gap-2">
              {vehicles.map((v) => (
                <Card key={v.id} className="flex items-center gap-3 p-3">
                  <CarFront className="size-5 shrink-0 text-fg-subtle" aria-hidden />
                  <div className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">
                      {v.make} {v.model}
                      {v.year ? `, ${v.year}` : ''}
                    </span>
                    <span className="truncate text-sm text-fg-muted">
                      {BODY_TYPE_LABELS[v.body_type]}
                      {v.color ? ` · ${v.color}` : ''}
                      {v.plate ? ` · ${v.plate}` : ''}
                    </span>
                  </div>
                  {canManage && (
                    <Button variant="ghost" size="icon-sm" aria-label="Изменить автомобиль" onClick={() => setVehicle(v)}>
                      <Pencil />
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          )}
        </Section>

        <Section title="История">
          {bookings.length === 0 ? (
            <p className="rounded-xl bg-sunken p-4 text-sm text-fg-muted">Записей пока нет.</p>
          ) : (
            <ul className="grid divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {bookings.map((b) => (
                <li key={b.id}>
                  <button type="button" onClick={() => sheets.open({ booking: b.id })} className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-surface-2 focus-visible:bg-surface-2">
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate font-medium">{b.service_name}</span>
                      <span className="truncate text-sm text-fg-muted first-letter:uppercase">
                        {when(b.starts_at, tz, locale)}
                        {b.vehicle_id && vehicleName.get(b.vehicle_id) ? ` · ${vehicleName.get(b.vehicle_id)}` : ''}
                      </span>
                    </span>
                    <span className="grid justify-items-end gap-1">
                      <span className={cn('text-sm font-semibold tabular', b.status === 'cancelled' && 'text-fg-subtle line-through')}>{money(b.price_cents, b.currency, locale)}</span>
                      <StatusBadge status={b.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {payments && payments.length > 0 && (
          <Section title="Оплаты">
            <Card className="grid gap-2 p-4">
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between gap-3 text-sm">
                  <span className="text-fg-muted">
                    {when(p.paid_at, tz, locale)} · {PAYMENT_METHOD_LABEL[p.method]}
                    {p.kind === 'refund' ? ' · возврат' : ''}
                  </span>
                  <span className={cn('tabular', p.kind === 'refund' && 'text-danger')}>
                    {p.kind === 'refund' ? '−' : ''}
                    {money(p.amount_cents, currency, locale)}
                  </span>
                </div>
              ))}
            </Card>
          </Section>
        )}
      </div>

      <BottomSheet isOpen={editing} onOpenChange={setEditing} label="Изменить клиента" height="tall" purpose="form">
        {editing && (
          <SheetFrame title="Клиент" onClose={() => setEditing(false)}>
            <div className="px-4 pb-8">
              <CustomerForm initial={c} onSaved={() => setEditing(false)} />
            </div>
          </SheetFrame>
        )}
      </BottomSheet>
      <BottomSheet isOpen={vehicle !== null} onOpenChange={(o) => !o && setVehicle(null)} label="Автомобиль" height="tall" purpose="form">
        {vehicle !== null && (
          <SheetFrame title={vehicle === 'new' ? 'Новый автомобиль' : 'Автомобиль'} onClose={() => setVehicle(null)}>
            <div className="px-4 pb-8">
              <VehicleForm
                initial={vehicle === 'new' ? undefined : { ...vehicle, comment: vehicle.owner_notes }}
                submitLabel="Сохранить"
                busy={saveVehicle.isPending}
                error={saveVehicle.error ? errorMessage(saveVehicle.error) : null}
                onSubmit={(v) => saveVehicle.mutate({ ...v, owner_notes: v.comment ?? '' }, { onSuccess: () => setVehicle(null) })}
              />
            </div>
          </SheetFrame>
        )}
      </BottomSheet>
    </>
  )
}
