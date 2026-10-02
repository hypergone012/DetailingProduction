import { Clock } from 'lucide-react'
import { Link } from 'react-router'
import { Img } from '@/components/Img'
import { Button } from '@/components/ui/button'
import { duration, money } from '@/lib/format'
import { useTenant } from '@/tenant/TenantProvider'
import { useBookingFlow } from '../booking/flow'
import { hasPriceRange, minPrice, priceFor, useProfile } from '../data'
import { SiteSection } from '../layout/site'

/**
 * Desktop (lg+): the studio's services priced for the client's car, in whole rows, below the
 * garage and history lists — a booking one click away instead of an empty column.
 */
export function ServicePicks({ title, vehicleId, cols = 3 }: { title?: string; vehicleId?: string; cols?: 2 | 3 }) {
  const { slug, data, currency, locale, mediaFor } = useTenant()
  const flow = useBookingFlow()
  const { profile } = useProfile()
  const v = vehicleId ? profile?.vehicles.find((x) => x.id === vehicleId) : profile?.vehicles[0]
  const fits = data.services.filter((s) => !v || !s.allowed_body_types || s.allowed_body_types.includes(v.body_type))
  // Whole rows (at least one row), at most two.
  const list = fits.slice(0, fits.length >= cols ? Math.min(cols * 2, fits.length - (fits.length % cols)) : fits.length)
  if (list.length === 0) return null
  const car = v ? v.nickname || `${v.make} ${v.model}` : null
  return (
    <SiteSection
      title={title ?? (car ? `Услуги для ${car}` : 'Услуги студии')}
      subtitle={car ? 'Цены уже рассчитаны для вашего кузова.' : 'Добавьте автомобиль — цены посчитаются для вашего кузова.'}
      action={
        <Link to={`/s/${slug}/services`} className="text-[15px] font-medium text-accent-text">
          Все услуги
        </Link>
      }
      className="hidden lg:grid"
    >
      <ul className={cols === 2 ? 'grid grid-cols-2 gap-5' : 'grid grid-cols-3 gap-5'}>
        {list.map((s) => {
          const mine = v ? priceFor(s, v.body_type) : null
          const href = `/s/${slug}/services/${s.id}`
          return (
            <li key={s.id} className="group flex flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card transition-colors hover:border-line-strong">
              <Link to={href} tabIndex={-1} aria-hidden className="overflow-hidden">
                <Img media={mediaFor('service', s.id)[0]} sizes="320px" className="aspect-[16/10] w-full transition-transform duration-500 group-hover:scale-[1.04]" alt="" />
              </Link>
              <div className="flex flex-1 flex-col gap-3 p-5">
                <Link to={href} className="rounded text-lg leading-snug font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus">
                  {s.name}
                </Link>
                <span className="flex items-center gap-1.5 text-sm text-fg-subtle">
                  <Clock className="size-4" aria-hidden />
                  {s.multi_day ? 'несколько дней' : duration(mine?.duration_min ?? s.duration_min)}
                </span>
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
                  <span className="text-xl font-bold tabular">
                    {mine ? money(mine.price_cents, currency, locale) : `${hasPriceRange(s) ? 'от ' : ''}${money(minPrice(s), currency, locale)}`}
                  </span>
                  <Button
                    size="sm"
                    onClick={() =>
                      flow.start({ serviceId: s.id, ...(v ? { vehicle: { kind: 'saved' as const, id: v.id, body_type: v.body_type, label: car! } } : {}) })
                    }
                  >
                    Записать
                  </Button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </SiteSection>
  )
}
