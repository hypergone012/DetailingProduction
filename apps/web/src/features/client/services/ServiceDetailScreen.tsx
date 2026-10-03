import { BODY_TYPE_LABELS } from '@dp/core/tenant/constants'
import { AlertTriangle, CalendarPlus, CheckCircle2, ClipboardList, Clock } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Img } from '@/components/Img'
import { Button } from '@/components/ui/button'
import { duration, money } from '@/lib/format'
import { useTenant } from '@/tenant/TenantProvider'
import { StatusScreen } from '@/app/StatusScreen'
import { useBookingFlow } from '../booking/flow'
import { ScreenHeader } from '@/components/ScreenHeader'
import { hasPriceRange, minPrice, priceFor, useProfile } from '../data'
import { Card } from '@/components/Section'
import { cn } from '@/lib/utils'
import { PAGE, SiteSection } from '../layout/site'

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
  const start = () =>
    flow.start({
      serviceId: s.id,
      ...(myVehicle ? { vehicle: { kind: 'saved' as const, id: myVehicle.id, body_type: myVehicle.body_type, label: myVehicle.nickname || `${myVehicle.make} ${myVehicle.model}` } } : {}),
    })
  const price = mine ? money(mine.price_cents, currency, locale) : `${hasPriceRange(s) ? 'от ' : ''}${money(minPrice(s), currency, locale)}`
  // Phone: one column in reading order (order-*). Desktop: story on the left, price and booking on the right.
  return (
    <>
      <ScreenHeader title={s.name} parent={`/s/${slug}/services`} site subtitle={s.summary} />
      <div className={cn(PAGE, 'grid gap-6 px-4 pb-32 lg:grid-cols-12 lg:items-start lg:gap-10 lg:pb-4')}>
        <div className="contents lg:col-span-7 lg:grid lg:gap-10">
          {images.length > 0 && (
            <div
              className="scroll-x -mx-4 order-1 flex gap-2 px-4 outline-none focus-visible:ring-2 focus-visible:ring-focus lg:order-none lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-3 lg:overflow-visible lg:px-0"
              role="region"
              aria-label={`Фото: ${s.name}`}
              tabIndex={0}
            >
              {images.map((m, i) => (
                <Img
                  key={m.id}
                  media={m}
                  priority={i === 0}
                  sizes={i === 0 ? '(min-width: 1024px) 820px, 92vw' : '(min-width: 1024px) 270px, 92vw'}
                  className="aspect-[16/10] w-[92%] shrink-0 snap-center rounded-2xl lg:w-full lg:rounded-3xl lg:shadow-card lg:first:col-span-3"
                />
              ))}
            </div>
          )}
          <div className="order-2 grid gap-2 lg:order-none lg:gap-4">
            <p className="text-[15px] leading-relaxed text-fg-muted lg:text-[19px] lg:text-fg">{s.description || s.summary}</p>
            <p className="flex items-center gap-1.5 text-sm text-fg-subtle lg:text-base">
              <Clock className="size-4" aria-hidden />
              {s.multi_day ? `${duration(s.duration_min)} работы · автомобиль остаётся в студии на несколько дней` : duration(s.duration_min)}
            </p>
          </div>

          {s.benefits.length > 0 && (
            <SiteSection title="Что входит" className="order-4 lg:order-none">
              <ul className="grid gap-2 lg:grid-cols-2 lg:gap-3">
                {s.benefits.map((b) => (
                  <li key={b} className="flex gap-2.5 text-[15px] lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:p-4 lg:text-base">
                    <CheckCircle2 className="mt-0.5 size-[18px] shrink-0 text-success" aria-hidden />
                    {b}
                  </li>
                ))}
              </ul>
            </SiteSection>
          )}

          {(s.prep_notes.length > 0 || s.restrictions.length > 0) && (
            <SiteSection title="Перед визитом" className="order-6 lg:order-none">
              <div className="grid gap-2 text-sm lg:text-base">
                {s.prep_notes.map((n) => (
                  <p key={n} className="flex gap-2.5 rounded-xl bg-sunken p-3 lg:p-4">
                    <ClipboardList className="mt-0.5 size-4 shrink-0 text-fg-muted lg:size-5" aria-hidden /> {n}
                  </p>
                ))}
                {s.restrictions.map((n) => (
                  <p key={n} className="flex gap-2.5 rounded-xl bg-warning-subtle p-3 text-fg lg:p-4">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning lg:size-5" aria-hidden /> {n}
                  </p>
                ))}
              </div>
            </SiteSection>
          )}
        </div>

        <aside className="contents lg:sticky lg:top-[calc(var(--dp-header-offset,0px)+24px)] lg:col-span-5 lg:grid lg:gap-8">
          <Card className="ring-glow hidden gap-5 rounded-3xl p-8 lg:grid">
            <div className="grid gap-1">
              <span className="text-sm text-fg-subtle">{mine && myVehicle ? `Для ${myVehicle.nickname || `${myVehicle.make} ${myVehicle.model}`}` : 'Стоимость'}</span>
              <span className="text-gradient text-[44px] leading-none font-bold tracking-tight tabular">{price}</span>
            </div>
            <p className="flex items-center gap-2 text-[15px] text-fg-muted">
              <Clock className="size-5" aria-hidden />
              {s.multi_day ? 'Несколько дней, автомобиль остаётся в студии' : duration(s.duration_min)}
            </p>
            <Button size="lg" block className="sheen h-14 text-[17px]" onClick={start}>
              <CalendarPlus /> Записаться
            </Button>
            <p className="text-sm text-fg-subtle">Свободное время и итоговая цена для вашего кузова — на следующем шаге.</p>
          </Card>

          <SiteSection title="Стоимость" className="order-3 lg:order-none">
            <Card className="grid gap-2 p-4 text-sm lg:gap-3 lg:rounded-3xl lg:p-6 lg:text-base">
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
          </SiteSection>

          {s.addons.length > 0 && (
            <SiteSection title="Дополнительно" className="order-5 lg:order-none">
              <Card className="divide-y divide-line lg:rounded-3xl">
                {s.addons.map((a) => (
                  <div key={a.id} className="flex items-start justify-between gap-3 p-3.5 text-sm lg:p-5 lg:text-base">
                    <div className="grid gap-0.5">
                      <span className="font-medium">{a.name}</span>
                      {a.description && <span className="text-fg-muted lg:text-[15px]">{a.description}</span>}
                    </div>
                    <span className="shrink-0 font-semibold tabular">+{money(a.price_cents, currency, locale)}</span>
                  </div>
                ))}
              </Card>
            </SiteSection>
          )}

          {recommended.length > 0 && (
            <SiteSection title="Студия рекомендует вместе" className="order-7 lg:order-none">
              <div className="grid gap-2">
                {recommended.map((r) => (
                  <Link key={r.id} to={`/s/${slug}/services/${r.id}`} className="pressable flex items-center justify-between rounded-xl border border-line bg-surface p-3.5 text-sm lg:rounded-2xl lg:p-5 lg:text-base lg:hover:border-line-strong">
                    <span className="font-medium">{r.name}</span>
                    <span className="tabular text-fg-muted">
                      {hasPriceRange(r) ? 'от ' : ''}
                      {money(minPrice(r), currency, locale)}
                    </span>
                  </Link>
                ))}
              </div>
            </SiteSection>
          )}
        </aside>
      </div>
      <div className="fixed inset-x-0 bottom-[calc(var(--dp-nav-height)+var(--dp-safe-bottom))] z-30 md:bottom-0 border-t border-line bg-bg-elevated/95 backdrop-blur-sm lg:hidden">
        <div className="mx-auto flex max-w-xl md:max-w-2xl items-center gap-3 px-4 py-3">
          <div className="grid min-w-0 flex-1">
            <span className="truncate text-sm text-fg-muted">{s.name}</span>
            <span className="font-semibold tabular">{price}</span>
          </div>
          <Button size="lg" onClick={start}>
            Записаться
          </Button>
        </div>
      </div>
    </>
  )
}
