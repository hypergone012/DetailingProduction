import { BottomSheet } from '@astryxdesign/core/BottomSheet'
import { useToast } from '@astryxdesign/core/Toast'
import { BODY_TYPE_LABELS } from '@dp/core/tenant/constants'
import { CarFront, ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api/http'
import { when } from '@/lib/format'
import { Stagger, StaggerItem } from '@/motion/Stagger'
import { useTenant } from '@/tenant/TenantProvider'
import { ScreenHeader } from '@/components/ScreenHeader'
import { isUpcoming, useProfile, useSaveVehicle } from '../data'
import { EmptyState } from '@/components/Section'
import { VehicleGlyph } from '@/components/VehicleGlyph'
import { SheetFrame } from '@/components/SheetFrame'
import { VehicleForm } from '@/components/VehicleForm'

export function GarageScreen() {
  const { slug, tz, locale } = useTenant()
  const { profile, isFetching } = useProfile()
  const [adding, setAdding] = useState(false)
  const save = useSaveVehicle()
  const showToast = useToast()
  const vehicles = profile?.vehicles ?? []
  return (
    <>
      <ScreenHeader
        title="Мой гараж"
        large
        actions={
          vehicles.length > 0 && (
            <Button variant="ghost" size="icon" aria-label="Добавить автомобиль" onClick={() => setAdding(true)}>
              <Plus />
            </Button>
          )
        }
      />
      <div className="mx-auto grid max-w-xl gap-3 px-4 pt-1 pb-8">
        {!profile && isFetching ? (
          <>
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </>
        ) : vehicles.length === 0 ? (
          <EmptyState
            icon={<CarFront />}
            title="Здесь будут ваши автомобили"
            text="Добавьте машину — цены сразу посчитаются для вашего кузова, а история обслуживания будет в одном месте."
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus /> Добавить автомобиль
              </Button>
            }
          />
        ) : (
          <Stagger as="ul" className="grid gap-3">
            {vehicles.map((v) => {
              const visits = profile?.bookings.filter((b) => b.vehicle_id === v.id && b.status === 'completed').length ?? 0
              const next = profile?.bookings.filter((b) => b.vehicle_id === v.id && isUpcoming(b)).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
              return (
                <StaggerItem as="li" key={v.id}>
                  <Link to={`/s/${slug}/garage/${v.id}`} className="pressable flex items-center gap-4 rounded-2xl border border-line bg-surface p-3 shadow-card outline-none focus-visible:ring-2 focus-visible:ring-focus">
                    {v.photo?.url ? (
                      <img src={v.photo.url} alt="" className="h-16 w-24 rounded-xl object-cover" />
                    ) : (
                      <span className="grid h-16 w-24 place-items-center rounded-xl bg-sunken">
                        <VehicleGlyph className="h-9 w-20" />
                      </span>
                    )}
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <p className="truncate font-semibold">{v.nickname || `${v.make} ${v.model}`}</p>
                      <p className="truncate text-sm text-fg-muted">
                        {v.nickname ? `${v.make} ${v.model} · ` : ''}
                        {BODY_TYPE_LABELS[v.body_type]}
                        {v.year ? ` · ${v.year}` : ''}
                      </p>
                      <p className="truncate text-xs text-fg-subtle first-letter:uppercase">
                        {next ? <span className="text-accent-text">Запись: {when(next.starts_at, tz, locale)}</span> : visits ? `Визитов: ${visits}` : 'Ещё не обслуживался'}
                      </p>
                    </div>
                    <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
                  </Link>
                </StaggerItem>
              )
            })}
          </Stagger>
        )}
      </div>
      <BottomSheet isOpen={adding} onOpenChange={setAdding} label="Новый автомобиль" height="tall" purpose="form">
        {adding && (
          <SheetFrame title="Новый автомобиль" onClose={() => setAdding(false)}>
            <VehicleForm
              submitLabel="Сохранить в гараж"
              busy={save.isPending}
              error={save.error ? errorMessage(save.error) : null}
              onSubmit={(v) =>
                save.mutate(v, {
                  onSuccess: () => {
                    setAdding(false)
                    showToast({ body: 'Автомобиль добавлен в гараж' })
                  },
                })
              }
            />
          </SheetFrame>
        )}
      </BottomSheet>
    </>
  )
}
