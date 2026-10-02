import { ChevronRight, Clock } from 'lucide-react'
import { Img } from '@/components/Img'
import { duration, money } from '@/lib/format'
import { useTenant } from '@/tenant/TenantProvider'
import { hasPriceRange, minPrice } from '../../data'
import { useBookingFlow } from '../flow'
import { SheetFrame } from '@/components/SheetFrame'

export function ServiceStep() {
  const { data, currency, locale, mediaFor } = useTenant()
  const flow = useBookingFlow()
  return (
    <SheetFrame title="Выберите услугу" step={1} onClose={flow.close}>
      <ul className="grid gap-2">
        {data.services.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => {
                flow.update({ serviceId: s.id, addonIds: [], slot: null })
                flow.go(flow.draft.vehicle ? 'slot' : 'vehicle')
              }}
              className="pressable flex w-full items-center gap-3 rounded-xl border border-line bg-bg-elevated p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Img media={mediaFor('service', s.id)[0]} sizes="64px" className="size-16 shrink-0 rounded-lg" alt="" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium">{s.name}</span>
                <span className="flex items-center gap-1 text-sm text-fg-muted">
                  <Clock className="size-3.5" aria-hidden />
                  {s.multi_day ? 'несколько дней' : duration(s.duration_min)}
                </span>
              </span>
              <span className="shrink-0 text-right text-sm font-semibold tabular">
                {hasPriceRange(s) ? 'от ' : ''}
                {money(minPrice(s), currency, locale)}
              </span>
              <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </SheetFrame>
  )
}
