import { BottomSheet } from '@astryxdesign/core/BottomSheet'
import { ChevronRight, EyeOff, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { ScreenHeader } from '@/components/ScreenHeader'
import { EmptyState } from '@/components/Section'
import { SheetFrame } from '@/components/SheetFrame'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api/http'
import { duration, money } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ServiceRow } from '../api/types'
import { useCatalog, useOwner } from '../data'
import { ServiceEditor } from './ServiceEditor'

export function ServicesScreen() {
  const { currency, locale, canManage } = useOwner()
  const catalog = useCatalog()
  const [editing, setEditing] = useState<ServiceRow | 'new' | null>(null)
  const services = catalog.data?.services ?? []
  return (
    <>
      <ScreenHeader
        title="Услуги и цены"
        large
        wide
        actions={
          canManage && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> Услуга
            </Button>
          )
        }
      />
      <div className="mx-auto grid max-w-3xl gap-4 px-4 pb-8">
        <p className="text-sm text-fg-muted">Изменения цены и длительности действуют для новых записей. Уже созданные записи сохраняют цену и время, с которыми были сделаны.</p>
        {catalog.isPending ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : catalog.isError ? (
          <p className="text-sm text-danger">{errorMessage(catalog.error)}</p>
        ) : services.length === 0 ? (
          <EmptyState icon={<Sparkles />} title="Услуг пока нет" text="Добавьте первую услугу — она сразу появится на странице записи." />
        ) : (
          <ul className="grid divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {services.map((s) => {
              const prices = [s.price_cents, ...s.service_variants.map((v) => v.price_cents)]
              const min = Math.min(...prices)
              const max = Math.max(...prices)
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => setEditing(s)}
                    className={cn('flex w-full items-center gap-3 px-4 py-3 text-left outline-none enabled:hover:bg-surface-2 focus-visible:bg-surface-2', !s.active && 'opacity-60')}
                  >
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {s.name}
                        {!s.active && <Badge tone="neutral">скрыта</Badge>}
                        {s.active && !s.bookable_online && (
                          <Badge tone="neutral">
                            <EyeOff /> только студия
                          </Badge>
                        )}
                        {s.requires_confirmation && <Badge tone="warning">с подтверждением</Badge>}
                      </span>
                      <span className="text-sm text-fg-muted">
                        {s.multi_day ? 'несколько дней' : duration(s.duration_min)}
                        {s.service_addons.length ? ` · допов ${s.service_addons.filter((a) => a.active).length}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular">
                      {min === max ? money(min, currency, locale) : `${money(min, currency, locale)} – ${money(max, currency, locale)}`}
                    </span>
                    {canManage && <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <BottomSheet isOpen={editing !== null} onOpenChange={(o) => !o && setEditing(null)} label="Услуга" height="tall" purpose="form">
        {editing !== null && (
          <SheetFrame title={editing === 'new' ? 'Новая услуга' : editing.name} onClose={() => setEditing(null)}>
            <ServiceEditor service={editing === 'new' ? null : editing} resources={catalog.data?.resources ?? []} onDone={() => setEditing(null)} />
          </SheetFrame>
        )}
      </BottomSheet>
    </>
  )
}
