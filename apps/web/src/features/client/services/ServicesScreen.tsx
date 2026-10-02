import type { ServiceView } from '@dp/core/api/contracts'
import { Bot, Check, ChevronRight, Clock, Phone } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useChatParam } from '@/components/assistant/chatParam'
import { Img } from '@/components/Img'
import { Button } from '@/components/ui/button'
import { duration, money } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Stagger, StaggerItem } from '@/motion/Stagger'
import { useTenant } from '@/tenant/TenantProvider'
import { ScreenHeader } from '@/components/ScreenHeader'
import { useBookingFlow } from '../booking/flow'
import { hasPriceRange, minPrice, useProfile } from '../data'
import { PAGE } from '../layout/site'

const CATEGORY_LABELS: Record<string, string> = {
  wash: 'Мойка',
  interior: 'Салон',
  paint: 'Кузов',
  protection: 'Защита',
  complex: 'Комплексы',
  other: 'Другое',
}

export function ServicesScreen() {
  const { slug, data, currency, locale, mediaFor } = useTenant()
  const categories = [...new Set(data.services.map((s) => s.category))]
  const [cat, setCat] = useState<string | null>(null)
  const list = cat ? data.services.filter((s) => s.category === cat) : data.services
  return (
    <>
      <ScreenHeader title="Услуги и запись" large site subtitle="Выберите услугу — стоимость сразу для вашего кузова, свободное время онлайн." />
      <div className={cn(PAGE, 'grid gap-4 px-4 pt-1 pb-8 lg:gap-8 lg:pt-0 lg:pb-4')}>
        {categories.length > 1 && (
          <div className="scroll-x -mx-4 flex gap-2 px-4 lg:mx-0 lg:flex-wrap lg:gap-3 lg:overflow-visible lg:px-0" role="group" aria-label="Категории">
            {[null, ...categories].map((c) => (
              <button
                key={c ?? 'all'}
                type="button"
                aria-pressed={cat === c}
                onClick={() => setCat(c)}
                className={cn(
                  'pressable h-9 shrink-0 rounded-full border px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus lg:h-12 lg:px-6 lg:text-base lg:font-medium lg:transition-colors',
                  cat === c ? 'border-transparent bg-accent text-accent-fg' : 'border-line bg-surface text-fg-muted lg:hover:text-fg',
                )}
              >
                {c === null ? 'Все' : (CATEGORY_LABELS[c] ?? c)}
                {c !== null && <span className="ml-2 hidden opacity-60 lg:inline">{data.services.filter((s) => s.category === c).length}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Phone: compact rows */}
        <Stagger as="ul" className="grid gap-3 lg:hidden" key={`m-${cat ?? 'all'}`}>
          {list.map((s) => (
            <StaggerItem as="li" key={s.id}>
              <Link to={`/s/${slug}/services/${s.id}`} className="pressable flex gap-3 rounded-2xl border border-line bg-surface p-2.5 shadow-card outline-none focus-visible:ring-2 focus-visible:ring-focus">
                <Img media={mediaFor('service', s.id)[0]} sizes="96px" className="size-24 shrink-0 rounded-xl" alt="" />
                <div className="grid min-w-0 flex-1 content-between gap-1 py-0.5">
                  <div className="grid gap-0.5">
                    <p className="font-semibold leading-snug">{s.name}</p>
                    <p className="line-clamp-2 text-sm text-fg-muted">{s.summary}</p>
                  </div>
                  <p className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-1 text-fg-subtle">
                      <Clock className="size-3.5" aria-hidden />
                      {s.multi_day ? 'несколько дней' : duration(s.duration_min)}
                    </span>
                    <span className="font-semibold tabular">
                      {hasPriceRange(s) ? 'от ' : ''}
                      {money(minPrice(s), currency, locale)}
                    </span>
                  </p>
                </div>
                <ChevronRight className="size-5 self-center text-fg-subtle" aria-hidden />
              </Link>
            </StaggerItem>
          ))}
        </Stagger>

        {/* Desktop: wide cards, two per row; an odd last slot gets the help card */}
        <Stagger as="ul" className="hidden grid-cols-2 gap-6 lg:grid" key={`d-${cat ?? 'all'}`}>
          {list.map((s) => (
            <StaggerItem as="li" key={s.id} className="flex">
              <ServiceCard service={s} />
            </StaggerItem>
          ))}
          {list.length % 2 === 1 && (
            <StaggerItem as="li" className="flex">
              <HelpCard />
            </StaggerItem>
          )}
        </Stagger>
      </div>
    </>
  )
}

function ServiceCard({ service: s }: { service: ServiceView }) {
  const { slug, currency, locale, mediaFor } = useTenant()
  const flow = useBookingFlow()
  const { profile } = useProfile()
  const vehicle = profile?.vehicles.find((v) => !s.allowed_body_types || s.allowed_body_types.includes(v.body_type))
  const href = `/s/${slug}/services/${s.id}`
  return (
    <article className="group flex w-full overflow-hidden rounded-3xl border border-line bg-surface shadow-card transition-colors hover:border-line-strong">
      <Link to={href} tabIndex={-1} aria-hidden className="relative w-[40%] shrink-0 overflow-hidden">
        <Img media={mediaFor('service', s.id)[0]} sizes="(min-width: 1440px) 290px, 20vw" className="absolute inset-0 size-full transition-transform duration-500 group-hover:scale-[1.04]" alt="" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-6">
        <div className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-accent-text">{CATEGORY_LABELS[s.category] ?? s.category}</span>
          <h2 className="text-[22px] leading-tight font-semibold">
            <Link to={href} className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus">
              {s.name}
            </Link>
          </h2>
        </div>
        {s.summary && <p className="text-[15px] leading-relaxed text-fg-muted">{s.summary}</p>}
        {s.benefits.length > 0 && (
          <ul className="grid gap-1.5 text-[15px]">
            {s.benefits.slice(0, 3).map((b) => (
              <li key={b} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <span className="line-clamp-1">{b}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-t border-line pt-4">
          <div className="grid gap-0.5">
            <span className="flex items-center gap-1.5 text-sm text-fg-subtle">
              <Clock className="size-4" aria-hidden />
              {s.multi_day ? 'несколько дней' : duration(s.duration_min)}
            </span>
            <span className="text-2xl font-bold tabular">
              {hasPriceRange(s) ? 'от ' : ''}
              {money(minPrice(s), currency, locale)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="secondary">
              <Link to={href}>Подробнее</Link>
            </Button>
            <Button
              onClick={() =>
                flow.start({
                  serviceId: s.id,
                  ...(vehicle ? { vehicle: { kind: 'saved' as const, id: vehicle.id, body_type: vehicle.body_type, label: vehicle.nickname || `${vehicle.make} ${vehicle.model}` } } : {}),
                })
              }
            >
              Записаться
            </Button>
          </div>
        </div>
      </div>
    </article>
  )
}

/** Closes an odd last row: how to choose when unsure. */
function HelpCard() {
  const { data } = useTenant()
  const chat = useChatParam()
  return (
    <div className="flex w-full flex-col justify-center gap-4 rounded-3xl border border-dashed border-line-strong bg-surface/40 p-8">
      <p className="text-[22px] font-semibold">Не знаете, что выбрать?</p>
      <p className="max-w-md text-[15px] leading-relaxed text-fg-muted">
        Расскажите, что хочется сделать с автомобилем, — подскажем подходящую услугу и рассчитаем стоимость для вашего кузова.
      </p>
      <div className="flex flex-wrap gap-2">
        {data.profile.phone && (
          <Button asChild variant="secondary">
            <a href={`tel:${data.profile.phone}`}>
              <Phone /> Позвонить
            </a>
          </Button>
        )}
        {data.features.ai !== false && (
          <Button variant="secondary" onClick={chat.show}>
            <Bot /> Спросить в чате
          </Button>
        )}
      </div>
    </div>
  )
}
