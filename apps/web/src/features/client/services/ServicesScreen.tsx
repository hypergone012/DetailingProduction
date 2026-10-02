import { ChevronRight, Clock } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Img } from '@/components/Img'
import { duration, money } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Stagger, StaggerItem } from '@/motion/Stagger'
import { useTenant } from '@/tenant/TenantProvider'
import { ScreenHeader } from '@/components/ScreenHeader'
import { hasPriceRange, minPrice } from '../data'

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
      <ScreenHeader title="Услуги и запись" large />
      <div className="mx-auto grid max-w-xl gap-4 px-4 pt-1 pb-8">
        {categories.length > 1 && (
          <div className="scroll-x -mx-4 flex gap-2 px-4" role="group" aria-label="Категории">
            {[null, ...categories].map((c) => (
              <button
                key={c ?? 'all'}
                type="button"
                aria-pressed={cat === c}
                onClick={() => setCat(c)}
                className={cn(
                  'pressable h-9 shrink-0 rounded-full border px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  cat === c ? 'border-transparent bg-accent text-accent-fg' : 'border-line bg-surface text-fg-muted',
                )}
              >
                {c === null ? 'Все' : (CATEGORY_LABELS[c] ?? c)}
              </button>
            ))}
          </div>
        )}
        <Stagger as="ul" className="grid gap-3" key={cat ?? 'all'}>
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
      </div>
    </>
  )
}
