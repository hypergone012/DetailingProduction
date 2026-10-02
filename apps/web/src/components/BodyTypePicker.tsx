import { BODY_TYPES, BODY_TYPE_LABELS, type BodyType } from '@dp/core/tenant/constants'
import { cn } from '@/lib/utils'

export function BodyTypePicker({ value, onChange, allowed, id }: { value: BodyType | null; onChange: (v: BodyType) => void; allowed?: BodyType[] | null; id?: string }) {
  return (
    <div role="radiogroup" aria-labelledby={id} className="grid grid-cols-2 gap-2">
      {BODY_TYPES.map((t) => {
        const disabled = Boolean(allowed && !allowed.includes(t))
        const checked = value === t
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(t)}
            className={cn(
              'pressable min-h-11 rounded-lg border px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus',
              checked ? 'border-accent-text bg-accent-subtle text-fg' : 'border-line bg-sunken text-fg-muted',
              disabled && 'opacity-40',
            )}
          >
            {BODY_TYPE_LABELS[t]}
          </button>
        )
      })}
    </div>
  )
}
