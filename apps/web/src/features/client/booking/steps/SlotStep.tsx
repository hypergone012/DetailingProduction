import { useCallback, useState } from 'react'
import type { AvailabilityResponse } from '@dp/core/api/contracts'
import { Button } from '@/components/ui/button'
import { dateLong, duration, money, span } from '@/lib/format'
import { useTenant } from '@/tenant/TenantProvider'
import { useBookingFlow } from '../flow'
import { SlotPicker } from '../SlotPicker'
import { SheetFrame } from './SheetFrame'

export function SlotStep() {
  const { service, tz, currency, locale } = useTenant()
  const flow = useBookingFlow()
  const s = service(flow.draft.serviceId)
  const [quote, setQuote] = useState<AvailabilityResponse | null>(null)
  const onLoaded = useCallback((a: AvailabilityResponse) => setQuote(a), [])
  if (!s) return null
  const slot = flow.draft.slot
  return (
    <SheetFrame
      title="Дата и время"
      step={3}
      onBack={flow.back}
      onClose={flow.close}
      footer={
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-fg-muted">
              {slot ? `${dateLong(slot.starts_at, tz, locale)}, ${span(slot.starts_at, slot.ends_at, tz, locale)}` : quote ? (quote.multi_day ? 'Работы займут несколько дней' : duration(quote.work_minutes)) : ' '}
            </span>
            {quote && <span className="shrink-0 text-lg font-semibold tabular">{money(quote.price_cents, currency, locale)}</span>}
          </div>
          <Button size="lg" block disabled={!slot} onClick={() => flow.go('confirm')}>
            Продолжить
          </Button>
        </div>
      }
    >
      <SlotPicker
        serviceId={s.id}
        bodyType={flow.bodyType}
        addonIds={flow.draft.addonIds}
        value={slot}
        onChange={(sl) => flow.update({ slot: sl })}
        onLoaded={onLoaded}
      />
    </SheetFrame>
  )
}
