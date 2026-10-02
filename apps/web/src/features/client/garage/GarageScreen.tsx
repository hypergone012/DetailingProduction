import { BottomSheet } from '@astryxdesign/core/BottomSheet'
import { useToast } from '@astryxdesign/core/Toast'
import { BODY_TYPE_LABELS } from '@dp/core/tenant/constants'
import { CalendarPlus, CarFront, ChevronRight, History, Plus, Sparkles, Tag } from 'lucide-react'
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
import { Card, EmptyState } from '@/components/Section'
import { cn } from '@/lib/utils'
import { useBookingFlow } from '../booking/flow'
import { suggestionText } from './suggestions'
import { PAGE, StudioContactCard } from '../layout/site'
import { ServicePicks } from '../shared/ServicePicks'
import { VehicleGlyph } from '@/components/VehicleGlyph'
import { SheetFrame } from '@/components/SheetFrame'
import { VehicleForm } from '@/components/VehicleForm'

export function GarageScreen() {
  const { slug, tz, locale } = useTenant()
  const flow = useBookingFlow()
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
        site
        subtitle="Ваши автомобили, история обслуживания и подсказки студии."
        actions={
          vehicles.length > 0 && (
            <>
              <Button variant="ghost" size="icon" aria-label="Добавить автомобиль" onClick={() => setAdding(true)} className="lg:hidden">
                <Plus />
              </Button>
              <Button variant="secondary" size="lg" onClick={() => setAdding(true)} className="hidden lg:inline-flex">
                <Plus /> Добавить автомобиль
              </Button>
            </>
          )
        }
      />
      <div className={cn(PAGE, 'grid gap-3 px-4 pt-1 pb-8 lg:grid-cols-12 lg:items-start lg:gap-8 lg:pt-0 lg:pb-4')}>
        <div className="contents lg:col-span-8 lg:grid lg:gap-12">
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
          <Stagger as="ul" className="grid gap-3 lg:gap-5">
            {vehicles.map((v) => {
              const visits = profile?.bookings.filter((b) => b.vehicle_id === v.id && b.status === 'completed').length ?? 0
              const next = profile?.bookings.filter((b) => b.vehicle_id === v.id && isUpcoming(b)).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
              const tip = v.suggestions[0]
              return (
                <StaggerItem as="li" key={v.id} className="lg:overflow-hidden lg:rounded-3xl lg:border lg:border-line lg:bg-surface lg:shadow-card">
                  <Link
                    to={`/s/${slug}/garage/${v.id}`}
                    className="pressable flex items-center gap-4 rounded-2xl border border-line bg-surface p-3 shadow-card outline-none focus-visible:ring-2 focus-visible:ring-focus lg:gap-6 lg:rounded-none lg:border-0 lg:p-6 lg:shadow-none lg:hover:bg-surface-2"
                  >
                    {v.photo?.url ? (
                      <img src={v.photo.url} alt="" className="h-16 w-24 rounded-xl object-cover lg:h-32 lg:w-52 lg:rounded-2xl" />
                    ) : (
                      <span className="grid h-16 w-24 place-items-center rounded-xl bg-sunken lg:h-32 lg:w-52 lg:rounded-2xl">
                        <VehicleGlyph className="h-9 w-20 lg:h-16 lg:w-40" />
                      </span>
                    )}
                    <div className="grid min-w-0 flex-1 gap-0.5 lg:gap-1.5">
                      <p className="truncate font-semibold lg:text-[26px] lg:font-bold lg:tracking-tight">{v.nickname || `${v.make} ${v.model}`}</p>
                      <p className="truncate text-sm text-fg-muted lg:text-[17px]">
                        {v.nickname ? `${v.make} ${v.model} · ` : ''}
                        {BODY_TYPE_LABELS[v.body_type]}
                        {v.year ? ` · ${v.year}` : ''}
                        {v.plate ? <span className="hidden lg:inline"> · {v.plate}</span> : null}
                      </p>
                      <p className="truncate text-xs text-fg-subtle first-letter:uppercase lg:text-[15px]">
                        {next ? <span className="text-accent-text">Запись: {when(next.starts_at, tz, locale)}</span> : visits ? `Визитов: ${visits}` : 'Ещё не обслуживался'}
                      </p>
                    </div>
                    <span className="hidden text-[15px] font-medium text-accent-text lg:inline">Открыть</span>
                    <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
                  </Link>
                  {tip && (
                    <div className="hidden items-center gap-4 border-t border-line bg-accent-subtle/60 px-6 py-4 lg:flex">
                      <Sparkles className="size-5 shrink-0 text-accent-text" aria-hidden />
                      <p className="flex-1 text-[15px]">{suggestionText(tip)}</p>
                      <Button
                        size="sm"
                        onClick={() => flow.start({ serviceId: tip.service_id, vehicle: { kind: 'saved', id: v.id, body_type: v.body_type, label: v.nickname || `${v.make} ${v.model}` } })}
                      >
                        Записать
                      </Button>
                    </div>
                  )}
                </StaggerItem>
              )
            })}
          </Stagger>
        )}
        {(profile || !isFetching) && <ServicePicks />}
        </div>
        <GarageAside />
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

/** Desktop side panel: book for the car, what the garage gives, the studio's contacts. */
function GarageAside() {
  const flow = useBookingFlow()
  const { profile } = useProfile()
  const v = profile?.vehicles[0]
  const perks = [
    { icon: <Tag />, title: 'Цена для вашего кузова', text: 'Стоимость услуг сразу считается для вашего автомобиля.' },
    { icon: <History />, title: 'История обслуживания', text: 'Все визиты и фото работ по каждой машине в одном месте.' },
    { icon: <Sparkles />, title: 'Подсказки студии', text: 'Подскажем, когда пора обновить защиту или сделать уход.' },
  ]
  return (
    <aside className="hidden content-start gap-6 lg:sticky lg:top-[calc(var(--dp-header-offset,0px)+24px)] lg:col-span-4 lg:grid">
      <Card className="grid gap-4 rounded-3xl p-6">
        <p className="text-xl font-semibold">Запись на обслуживание</p>
        <p className="text-[15px] text-fg-muted">
          {v ? `Выберите услугу — цена сразу для ${v.nickname || `${v.make} ${v.model}`}.` : 'Выберите услугу и удобное время онлайн.'}
        </p>
        <Button
          size="lg"
          block
          onClick={() => flow.start(v ? { vehicle: { kind: 'saved', id: v.id, body_type: v.body_type, label: v.nickname || `${v.make} ${v.model}` } } : {})}
        >
          <CalendarPlus /> Записаться
        </Button>
      </Card>
      <Card className="grid gap-5 rounded-3xl p-6">
        <p className="text-xl font-semibold">Что даёт гараж</p>
        <ul className="grid gap-4">
          {perks.map((p) => (
            <li key={p.title} className="flex gap-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent-text [&_svg]:size-5">{p.icon}</span>
              <span className="grid gap-0.5">
                <span className="font-medium">{p.title}</span>
                <span className="text-sm text-fg-muted">{p.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <StudioContactCard className="rounded-3xl" />
    </aside>
  )
}
