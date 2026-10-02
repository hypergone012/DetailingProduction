import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { useToast } from '@astryxdesign/core/Toast'
import { BODY_TYPE_LABELS } from '@dp/core/tenant/constants'
import { CarFront, Lock, MapPin, MessageSquareText, Phone, RefreshCw, Warehouse, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { StatusScreen } from '@/app/StatusScreen'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, errorMessage } from '@/lib/api/http'
import { dateLong, money, phonePretty, span, when } from '@/lib/format'
import { useTenant } from '@/tenant/TenantProvider'
import { useBookingFlow } from '../booking/flow'
import { ScreenHeader } from '@/components/ScreenHeader'
import { useBooking, useInvalidateClient } from '../data'
import { PushCard } from '../profile/PushCard'
import { CalendarButton } from '../shared/CalendarButton'
import { Card, Section } from '@/components/Section'
import { StatusBadge } from '@/components/StatusBadge'
import { RescheduleSheet } from './RescheduleSheet'

export function BookingDetailScreen() {
  const { id } = useParams()
  const { slug, api, tz, locale } = useTenant()
  const q = useBooking(id)
  const flow = useBookingFlow()
  const invalidate = useInvalidateClient()
  const showToast = useToast()
  const [moving, setMoving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  if (q.isPending) {
    return (
      <>
        <ScreenHeader title="Запись" parent={`/s/${slug}/history`} />
        <div className="mx-auto grid max-w-xl gap-3 px-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </>
    )
  }
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404
    return (
      <StatusScreen
        icon={notFound ? <Lock /> : <RefreshCw />}
        title={notFound ? 'Нет доступа к записи' : 'Не удалось загрузить запись'}
        text={notFound ? 'Откройте ссылку из сообщения студии на этом устройстве или запишитесь заново.' : errorMessage(q.error)}
      >
        {!notFound && <Button onClick={() => q.refetch()}>Повторить</Button>}
      </StatusScreen>
    )
  }
  const { booking: b, studio, media } = q.data
  const active = b.status === 'pending' || b.status === 'confirmed'
  const cancel = async () => {
    setCancelBusy(true)
    setCancelError(null)
    try {
      await api.cancel(b.id)
      await invalidate()
      setCancelling(false)
      showToast({ body: 'Запись отменена' })
    } catch (e) {
      setCancelError(errorMessage(e))
    } finally {
      setCancelBusy(false)
    }
  }

  return (
    <>
      <ScreenHeader title={`Запись ${b.code}`} parent={`/s/${slug}/history`} />
      <div className="mx-auto grid max-w-xl gap-6 px-4 pb-10">
        <Card className="grid gap-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <p className="text-xl font-semibold first-letter:uppercase">{dateLong(b.starts_at, tz, locale)}</p>
              <p className="text-fg-muted">{span(b.starts_at, b.ends_at, tz, locale)}</p>
            </div>
            <StatusBadge status={b.status} />
          </div>
          {b.status === 'pending' && <p className="rounded-lg bg-warning-subtle px-3 py-2 text-sm text-fg">Студия подтвердит запись. Если включить уведомления — сообщим сразу.</p>}
          {b.multi_day && active && <p className="rounded-lg bg-info-subtle px-3 py-2 text-sm text-fg">Работы займут несколько дней — автомобиль остаётся в студии до {when(b.ends_at, tz, locale)}.</p>}
          <div className="grid gap-3 border-t border-line pt-4 text-sm">
            <Line icon={<Wrench />}>{b.service.name}</Line>
            {b.vehicle && (
              <Line icon={<CarFront />}>
                {b.vehicle.nickname || `${b.vehicle.make} ${b.vehicle.model}`}
                {b.body_type ? <span className="text-fg-muted"> · {BODY_TYPE_LABELS[b.body_type]}</span> : null}
              </Line>
            )}
            {b.resource && <Line icon={<Warehouse />}>{b.resource.name}</Line>}
          </div>
          <div className="grid gap-1.5 border-t border-line pt-4 text-sm">
            {b.items.map((i, idx) => (
              <div key={idx} className="flex justify-between gap-3">
                <span className="text-fg-muted">{i.name}</span>
                <span className="tabular">{money(i.price_cents, b.currency, locale)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between gap-3 text-base font-semibold">
              <span>Итого</span>
              <span className="tabular">{money(b.price_cents, b.currency, locale)}</span>
            </div>
            <p className="text-xs text-fg-subtle">Цена зафиксирована на момент записи.</p>
          </div>
        </Card>

        {b.client_note && (
          <Card className="flex gap-3 p-4 text-sm">
            <MessageSquareText className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
            <p>
              <span className="font-medium">Комментарий студии: </span>
              {b.client_note}
            </p>
          </Card>
        )}

        {media.length > 0 && (
          <Section title="Фото работ">
            <div className="scroll-x -mx-4 flex gap-3 px-4 outline-none focus-visible:ring-2 focus-visible:ring-focus" role="region" aria-label="Фото работ" tabIndex={0}>
              {media.map((m) => (
                <figure key={m.id} className="w-56 shrink-0">
                  {m.url && <img src={m.url} alt={m.alt || m.caption} className="aspect-[4/3] w-full rounded-xl object-cover" loading="lazy" />}
                  <figcaption className="mt-1 text-xs text-fg-subtle">{m.kind === 'before' ? 'До' : m.kind === 'after' ? 'После' : m.caption}</figcaption>
                </figure>
              ))}
            </div>
          </Section>
        )}

        {active && (
          <Section title="Управление">
            <div className="grid gap-2">
              {b.can_modify ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setMoving(true)}>
                    Перенести
                  </Button>
                  <Button variant="danger" onClick={() => setCancelling(true)}>
                    Отменить
                  </Button>
                </div>
              ) : (
                <p className="rounded-xl bg-sunken p-3 text-sm text-fg-muted">
                  До визита меньше {studio.cancel_cutoff_hours} ч — перенести или отменить можно по телефону студии.
                </p>
              )}
              <CalendarButton bookingId={b.id} code={b.code} block />
            </div>
          </Section>
        )}
        {active && <PushCard compact />}

        {b.status === 'completed' && (
          <Button size="lg" block onClick={() => flow.start({ serviceId: b.service.id, ...(b.vehicle ? { vehicle: { kind: 'saved' as const, id: b.vehicle.id, body_type: b.vehicle.body_type, label: b.vehicle.nickname || `${b.vehicle.make} ${b.vehicle.model}` } } : {}) })}>
            Повторить запись
          </Button>
        )}

        <Section title={studio.name}>
          <Card className="grid gap-2 p-4 text-sm">
            {studio.address && (
              <a href={studio.map_url ?? undefined} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-fg-muted">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {studio.address}
              </a>
            )}
            {studio.phone && (
              <a href={`tel:${studio.phone}`} className="flex items-center gap-2 font-medium text-accent-text">
                <Phone className="size-4" aria-hidden /> {phonePretty(studio.phone)}
              </a>
            )}
          </Card>
        </Section>
      </div>
      <RescheduleSheet booking={b} open={moving} onOpenChange={setMoving} onDone={() => showToast({ body: 'Запись перенесена' })} />
      <AlertDialog
        isOpen={cancelling}
        onOpenChange={(o) => (setCancelling(o), setCancelError(null))}
        title="Отменить запись?"
        description={cancelError ?? `${b.service.name}, ${dateLong(b.starts_at, tz, locale)}. Время освободится для других клиентов.`}
        actionLabel="Отменить запись"
        cancelLabel="Оставить"
        onAction={cancel}
        isActionLoading={cancelBusy}
      />
    </>
  )
}

function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted [&_svg]:size-4">{icon}</span>
      <span>{children}</span>
    </p>
  )
}
