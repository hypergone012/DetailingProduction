import { BottomSheet } from '@astryxdesign/core/BottomSheet'
import type { BookingView, Slot } from '@dp/core/api/contracts'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ApiError, errorMessage } from '@/lib/api/http'
import { dateLong, span } from '@/lib/format'
import { actionKey, completeAction } from '@/lib/idempotency'
import { useTenant } from '@/tenant/TenantProvider'
import { SlotPicker } from '../booking/SlotPicker'
import { SheetFrame } from '../booking/steps/SheetFrame'
import { useInvalidateClient } from '../data'

/** Moving a booking: the server swaps the occupancy atomically; on failure the original stays. */
export function RescheduleSheet({ booking, open, onOpenChange, onDone }: { booking: BookingView; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { api, tz, locale } = useTenant()
  const invalidate = useInvalidateClient()
  const [slot, setSlot] = useState<Slot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const addonIds: string[] = []
  const submit = async () => {
    if (!slot) return
    setBusy(true)
    setError(null)
    const scope = `move:${booking.id}:${slot.starts_at}`
    try {
      await api.reschedule(booking.id, slot.starts_at, actionKey(scope))
      completeAction(scope)
      await invalidate()
      onOpenChange(false)
      onDone()
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) completeAction(scope)
      setError(errorMessage(e))
      void invalidate()
    } finally {
      setBusy(false)
    }
  }
  return (
    <BottomSheet isOpen={open} onOpenChange={onOpenChange} label="Перенос записи" height="tall">
      {open && (
        <SheetFrame
          title="Перенести запись"
          onClose={() => onOpenChange(false)}
          footer={
            <div className="grid gap-2">
              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error} Текущая запись сохранена.
                </p>
              )}
              <p className="text-sm text-fg-muted">
                Сейчас: {dateLong(booking.starts_at, tz, locale)}, {span(booking.starts_at, booking.ends_at, tz, locale)}
              </p>
              <Button size="lg" block disabled={!slot} loading={busy} onClick={submit}>
                {slot ? `Перенести на ${slot.local_time}, ${dateLong(slot.starts_at, tz, locale)}` : 'Выберите новое время'}
              </Button>
            </div>
          }
        >
          <SlotPicker serviceId={booking.service.id} bodyType={booking.body_type} addonIds={addonIds} value={slot} onChange={setSlot} rescheduleBookingId={booking.id} />
          <p className="mt-4 text-xs text-fg-subtle">Цена и состав работ останутся прежними: {booking.items.map((i) => i.name).join(', ')}.</p>
        </SheetFrame>
      )}
    </BottomSheet>
  )
}
