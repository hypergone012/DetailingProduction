import { m } from 'motion/react'
import { Button } from '@/components/ui/button'
import { dateLong, span } from '@/lib/format'
import { useTenant } from '@/tenant/TenantProvider'
import { CalendarButton } from '../../shared/CalendarButton'
import { PushCard } from '../../profile/PushCard'
import { useBookingFlow } from '../flow'
import { SheetFrame } from '@/components/SheetFrame'

export function DoneStep() {
  const { slug, tz, locale } = useTenant()
  const flow = useBookingFlow()
  const r = flow.draft.result
  if (!r) return null
  const b = r.booking
  const pending = b.status === 'pending'
  return (
    <SheetFrame title={pending ? 'Заявка отправлена' : 'Вы записаны'} onClose={flow.close}>
      <div className="grid gap-5 pt-2">
        <div className="grid justify-items-center gap-3 text-center">
          <svg viewBox="0 0 64 64" className="size-20 text-accent-text" aria-hidden>
            <m.circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="3" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5, ease: [0.25, 1, 0.5, 1] }} />
            <m.path d="M20 33 L28.5 41 L45 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.35, duration: 0.35, ease: [0.25, 1, 0.5, 1] }} />
          </svg>
          <div className="grid gap-1">
            <p className="text-xl font-semibold first-letter:uppercase">{dateLong(b.starts_at, tz, locale)}</p>
            <p className="text-fg-muted">
              {span(b.starts_at, b.ends_at, tz, locale)} · {b.service.name}
            </p>
            <p className="text-sm text-fg-subtle">
              Номер записи <span className="font-semibold tabular tracking-wider text-fg">{b.code}</span>
            </p>
          </div>
          {pending && <p className="max-w-xs text-sm text-warning">Студия проверит загрузку и подтвердит запись.</p>}
        </div>
        <CalendarButton bookingId={b.id} code={b.code} block />
        <PushCard compact />
        <div className="grid gap-2">
          <Button size="lg" block onClick={() => flow.closeTo(`/s/${slug}/history/${b.id}`)}>
            Открыть запись
          </Button>
          <Button variant="ghost" block onClick={flow.close}>
            Готово
          </Button>
        </div>
      </div>
    </SheetFrame>
  )
}
