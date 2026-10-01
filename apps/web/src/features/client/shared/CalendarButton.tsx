import { CalendarCheck, CalendarX2, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTenant } from '@/tenant/TenantProvider'

/**
 * Adds the booking to the device calendar via an .ics file fetched with this device's
 * credentials. The state shown is the real state of that request (no optimistic claims).
 */
export function CalendarButton({ bookingId, code, block = false }: { bookingId: string; code: string; block?: boolean }) {
  const { api } = useTenant()
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const run = async () => {
    setState('loading')
    try {
      const ics = await api.calendar(bookingId)
      const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `booking-${code}.ics`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setState('done')
    } catch {
      setState('error')
    }
  }
  return (
    <div className="grid gap-1.5">
      <Button variant="secondary" block={block} onClick={run} loading={state === 'loading'} aria-live="polite">
        {state === 'done' ? <CalendarCheck /> : state === 'error' ? <CalendarX2 /> : state === 'loading' ? <Loader2 className="hidden" /> : <CalendarCheck />}
        {state === 'done' ? 'Файл календаря сохранён' : state === 'error' ? 'Повторить экспорт в календарь' : 'Добавить в календарь'}
      </Button>
      {state === 'error' && <p className="text-sm text-danger">Не удалось сформировать файл календаря. Проверьте соединение.</p>}
      {state === 'done' && <p className="text-sm text-fg-muted">Откройте файл booking-{code}.ics, чтобы добавить событие в календарь.</p>}
    </div>
  )
}
