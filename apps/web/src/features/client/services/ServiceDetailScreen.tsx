import { BODY_TYPE_LABELS } from '@dp/core/tenant/constants'
import { AlertTriangle, CheckCircle2, ClipboardList, Clock } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Img } from '@/components/Img'
import { Button } from '@/components/ui/button'
import { duration, money } from '@/lib/format'
import { useTenant } from '@/tenant/TenantProvider'
import { StatusScreen } from '@/app/StatusScreen'
import { useBookingFlow } from '../booking/flow'
import { ScreenHeader } from '@/components/ScreenHeader'
import { hasPriceRange, minPrice, priceFor, useProfile } from '../data'
import { Card, Section } from '@/components/Section'

export function ServiceDetailScreen() {
  const { id } = useParams()
  const { slug, service, currency, locale, mediaFor } = useTenant()
  const flow = useBookingFlow()
  const { profile } = useProfile()
  const s = service(id)
  if (!s) return <StatusScreen title="Услуга недоступна" text="Возможно, студия изменила список услуг." />
  const images = mediaFor('service', s.id)
  const myVehicle = profile?.vehicles.find((v) => !s.allowed_body_types || s.allowed_body_types.includes(v.body_type))
  const mine = myVehicle ? priceFor(s, myVehicle.body_type) : null
  const recommended = s.recommended_ids.map((rid) => service(rid)).filter((x) => x !== undefined)
  return (
    <>
      <ScreenHeader title={s.name} parent={`/s/${slug}/services`} />
      <div className="mx-auto grid max-w-xl gap-6 px-4 pb-32">
        {images.length > 0 && (
          <div className="scroll-x -mx-4 flex gap-2 px-4 outline-none focus-visible:ring-2 focus-visible:ring-focus" role="region" aria-label={`Фото: ${s.name}`} tabIndex={0}>
            {images.map((m, i) => (
              <Img key={m.id} media={m} priority={i === 0} sizes="(max-width: 640px) 92vw, 600px" className="aspect-[16/10] w-[92%] shrink-0 snap-center rounded-2xl" />
            ))}
          </div>
        )}
        <div className="grid gap-2">
          <p className="text-[15px] leading-relaxed text-fg-muted">{s.description || s.summary}</p>
          <p className="flex items-center gap-1.5 text-sm text-fg-subtle">
            <Clock className="size-4" aria-hidden />
            {s.multi_day ? `${duration(s.duration_min)} работы · автомобиль остаётся в студии на несколько дней` : duration(s.duration_min)}
          </p>
        </div>

        <Section title="Стоимость">
          <Card className="grid gap-2 p-4 text-sm">
            {mine && myVehicle && (
              <div className="mb-1 flex items-center justify-between rounded-xl bg-accent-subtle px-3 py-2.5">
                <span>
                  Для {myVehicle.nickname || `${myVehicle.make} ${myVehicle.model}`}
                </span>
                <span className="text-base font-semibold tabular">{money(mine.price_cents, currency, locale)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-fg-muted">Базовая цена</span>
              <span className="tabular">{money(s.price_cents, currency, locale)}</span>
            </div>
            {s.variants.map((v) => (
              <div key={v.body_type} className="flex justify-between">
                <span className="text-fg-muted">{BODY_TYPE_LABELS[v.body_type]}</span>
                <span className="tabular">
                  {money(v.price_cents, currency, locale)}
                  {!s.multi_day && v.duration_min !== s.duration_min ? <span className="text-fg-subtle"> · {duration(v.duration_min)}</span> : null}
                </span>
              </div>
            ))}
            {s.allowed_body_types && <p className="pt-1 text-fg-subtle">Только для: {s.allowed_body_types.map((b) => BODY_TYPE_LABELS[b]).join(', ')}</p>}
          </Card>
        </Section>

        {s.benefits.length > 0 && (
          <Section title="Что входит">
            <ul className="grid gap-2">
              {s.benefits.map((b) => (
                <li key={b} className="flex gap-2.5 text-[15px]">
                  <CheckCircle2 className="mt-0.5 size-[18px] shrink-0 text-success" aria-hidden />
                  {b}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {s.addons.length > 0 && (
          <Section title="Дополнительно">
            <Card className="divide-y divide-line">
              {s.addons.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 p-3.5 text-sm">
                  <div className="grid gap-0.5">
                    <span className="font-medium">{a.name}</span>
                    {a.description && <span className="text-fg-muted">{a.description}</span>}
                  </div>
                  <span className="shrink-0 font-semibold tabular">+{money(a.price_cents, currency, locale)}</span>
                </div>
              ))}
            </Card>
          </Section>
        )}

        {(s.prep_notes.length > 0 || s.restrictions.length > 0) && (
          <Section title="Перед визитом">
            <div className="grid gap-2 text-sm">
              {s.prep_notes.map((n) => (
                <p key={n} className="flex gap-2.5 rounded-xl bg-sunken p-3">
                  <ClipboardList className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden /> {n}
                </p>
              ))}
              {s.restrictions.map((n) => (
                <p key={n} className="flex gap-2.5 rounded-xl bg-warning-subtle p-3 text-fg">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> {n}
                </p>
              ))}
            </div>
          </Section>
        )}

        {recommended.length > 0 && (
          <Section title="Студия рекомендует вместе">
            <div className="grid gap-2">
              {recommended.map((r) => (
                <Link key={r.id} to={`/s/${slug}/services/${r.id}`} className="pressable flex items-center justify-between rounded-xl border border-line bg-surface p-3.5 text-sm">
                  <span className="font-medium">{r.name}</span>
                  <span className="tabular text-fg-muted">
                    {hasPriceRange(r) ? 'от ' : ''}
                    {money(minPrice(r), currency, locale)}
                  </span>
                </Link>
              ))}
            </div>
          </Section>
        )}
      </div>
      <div className="fixed inset-x-0 bottom-[calc(var(--dp-nav-height)+var(--dp-safe-bottom))] z-30 border-t border-line bg-bg-elevated/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <div className="grid min-w-0 flex-1">
            <span className="truncate text-sm text-fg-muted">{s.name}</span>
            <span className="font-semibold tabular">
              {mine ? money(mine.price_cents, currency, locale) : `${hasPriceRange(s) ? 'от ' : ''}${money(minPrice(s), currency, locale)}`}
            </span>
          </div>
          <Button
            size="lg"
            onClick={() =>
              flow.start({
                serviceId: s.id,
                ...(myVehicle ? { vehicle: { kind: 'saved' as const, id: myVehicle.id, body_type: myVehicle.body_type, label: myVehicle.nickname || `${myVehicle.make} ${myVehicle.model}` } } : {}),
              })
            }
          >
            Записаться
          </Button>
        </div>
      </div>
    </>
  )
}
