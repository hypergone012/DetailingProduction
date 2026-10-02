import { zonedToInstant } from '@dp/core/time/zoned'
import { addDays, dayParts } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { OwnerSlot } from '../api/types'

/** Day strip + free start times (with how many resources are free) for owner scheduling. */
export function DayStrip({ from, days, value, onChange, counts }: { from: string; days: number; value: string; onChange: (d: string) => void; counts?: Record<string, number> }) {
  return (
    <div className="scroll-x -mx-4 flex gap-2 px-4 pb-1" role="group" aria-label="Дата">
      {Array.from({ length: days }, (_, i) => addDays(from, i)).map((d) => {
        const p = dayParts(d)
        const selected = d === value
        const n = counts?.[d]
        return (
          <button
            key={d}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(d)}
            className={cn(
              'pressable grid w-14 shrink-0 justify-items-center gap-0.5 rounded-xl border py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus',
              selected ? 'border-accent-text bg-accent-subtle' : 'border-line bg-bg-elevated',
            )}
          >
            <span className="text-[11px] uppercase text-fg-subtle">{p.weekday}</span>
            <span className="text-base font-semibold tabular">{p.day}</span>
            {counts && <span className={cn('text-[10px]', n ? 'text-fg-muted' : 'text-fg-subtle')}>{n ? n : '—'}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function SlotTimes({ slots, value, onChange }: { slots: OwnerSlot[]; value: string | null; onChange: (s: OwnerSlot) => void }) {
  if (slots.length === 0) return <p className="rounded-xl bg-sunken p-3 text-sm text-fg-muted">Свободного времени нет. Выберите другой день или укажите время вручную.</p>
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Время">
      {slots.map((s) => {
        const checked = s.starts_at === value
        return (
          <button
            key={s.starts_at}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(s)}
            className={cn(
              'pressable grid h-12 place-items-center rounded-lg border text-sm font-medium tabular outline-none focus-visible:ring-2 focus-visible:ring-focus',
              checked ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-bg-elevated',
            )}
          >
            <span>{s.local_time}</span>
            {s.free_resources > 1 && <span className={cn('-mt-1 text-[10px]', checked ? 'text-accent-fg' : 'text-fg-subtle')}>×{s.free_resources}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function slotsByDay(slots: OwnerSlot[]): Record<string, OwnerSlot[]> {
  const out: Record<string, OwnerSlot[]> = {}
  for (const s of slots) (out[s.local_day] ??= []).push(s)
  return out
}

/** Noon of a studio day as an instant (for formatting a day label in the studio timezone). */
export function dayNoon(day: string, tz: string): Date {
  return zonedToInstant(day, '12:00', tz)
}
