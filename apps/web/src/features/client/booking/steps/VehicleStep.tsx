import { BODY_TYPE_LABELS } from '@dp/core/tenant/constants'
import { Check, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { duration, money } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useTenant } from '@/tenant/TenantProvider'
import { priceFor, useProfile } from '../../data'
import { VehicleForm } from '../../garage/VehicleForm'
import { VehicleGlyph } from '../../shared/VehicleGlyph'
import { useBookingFlow, type VehicleChoice } from '../flow'
import { SheetFrame } from './SheetFrame'

export function VehicleStep() {
  const { service, currency, locale } = useTenant()
  const flow = useBookingFlow()
  const s = service(flow.draft.serviceId)
  const { profile, isFetching } = useProfile()
  const vehicles = profile?.vehicles ?? []
  const [adding, setAdding] = useState(false)
  if (!s) return null
  const allowed = s.allowed_body_types
  const selected = flow.draft.vehicle
  const choose = (v: VehicleChoice) => flow.update({ vehicle: v, slot: null })
  const addonsTotal = s.addons.filter((a) => flow.draft.addonIds.includes(a.id)).reduce((n, a) => n + a.price_cents, 0)
  const base = priceFor(s, flow.bodyType)
  const hasItems = vehicles.length > 0 || selected?.kind === 'new'
  const showForm = adding || (!hasItems && !isFetching)

  return (
    <SheetFrame
      title="Автомобиль"
      step={2}
      onBack={flow.back}
      onClose={flow.close}
      footer={
        selected && !showForm ? (
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-fg-muted">
                {s.name} · {s.multi_day ? 'несколько дней' : duration(base.duration_min + s.addons.filter((a) => flow.draft.addonIds.includes(a.id)).reduce((n, a) => n + a.duration_min, 0))}
              </span>
              <span className="text-lg font-semibold tabular">{money(base.price_cents + addonsTotal, currency, locale)}</span>
            </div>
            <Button size="lg" block onClick={() => flow.go('slot')}>
              Выбрать время
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-5">
        {hasItems && !adding && (
          <ul className="grid gap-2" role="radiogroup" aria-label="Ваши автомобили">
            {vehicles.map((v) => {
              const disabled = Boolean(allowed && !allowed.includes(v.body_type))
              const checked = selected?.kind === 'saved' && selected.id === v.id
              const p = priceFor(s, v.body_type)
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={disabled}
                    onClick={() => choose({ kind: 'saved', id: v.id, body_type: v.body_type, label: v.nickname || `${v.make} ${v.model}` })}
                    className={cn(
                      'pressable flex w-full items-center gap-3 rounded-xl border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      checked ? 'border-accent-text bg-accent-subtle' : 'border-line bg-bg-elevated',
                      disabled && 'opacity-45',
                    )}
                  >
                    {v.photo?.url ? <img src={v.photo.url} alt="" className="size-12 rounded-lg object-cover" /> : <VehicleGlyph className="h-12 w-16 shrink-0" />}
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{v.nickname || `${v.make} ${v.model}`}</span>
                      <span className="truncate text-sm text-fg-muted">
                        {v.nickname ? `${v.make} ${v.model} · ` : ''}
                        {BODY_TYPE_LABELS[v.body_type]}
                        {disabled ? ' · не обслуживается' : ''}
                      </span>
                    </span>
                    {!disabled && <span className="text-sm font-semibold tabular">{money(p.price_cents, currency, locale)}</span>}
                    {checked && <Check className="size-5 text-accent-text" aria-hidden />}
                  </button>
                </li>
              )
            })}
            {selected?.kind === 'new' && (
              <li className="flex items-center gap-3 rounded-xl border border-accent-text bg-accent-subtle p-3">
                <VehicleGlyph className="h-12 w-16" />
                <span className="flex-1 font-medium">
                  {selected.data.make} {selected.data.model}
                </span>
                <Check className="size-5 text-accent-text" aria-hidden />
              </li>
            )}
          </ul>
        )}
        {showForm ? (
          <div className="grid gap-3">
            {vehicles.length > 0 && <p className="text-sm font-medium">Новый автомобиль</p>}
            <VehicleForm
              compact
              allowed={allowed}
              initial={selected?.kind === 'new' ? selected.data : undefined}
              submitLabel="Продолжить"
              onSubmit={(v) => {
                if (allowed && !allowed.includes(v.body_type)) return
                choose({ kind: 'new', data: v })
                setAdding(false)
                flow.go('slot')
              }}
            />
            {vehicles.length > 0 && (
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Выбрать из гаража
              </Button>
            )}
          </div>
        ) : (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Другой автомобиль
          </Button>
        )}

        {s.addons.length > 0 && !showForm && (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Дополнительно</legend>
            {s.addons.map((a) => {
              const on = flow.draft.addonIds.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => flow.update({ addonIds: on ? flow.draft.addonIds.filter((x) => x !== a.id) : [...flow.draft.addonIds, a.id], slot: null })}
                  className={cn(
                    'pressable flex items-center gap-3 rounded-xl border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    on ? 'border-accent-text bg-accent-subtle' : 'border-line bg-bg-elevated',
                  )}
                >
                  <span className={cn('grid size-5 shrink-0 place-items-center rounded-md border', on ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong')}>
                    {on && <Check className="size-3.5" aria-hidden />}
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span className="font-medium">{a.name}</span>
                    {a.description && <span className="text-sm text-fg-muted">{a.description}</span>}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular">+{money(a.price_cents, currency, locale)}</span>
                </button>
              )
            })}
          </fieldset>
        )}
      </div>
    </SheetFrame>
  )
}
