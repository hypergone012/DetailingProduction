import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { BottomSheet } from '@astryxdesign/core/BottomSheet'
import { useToast } from '@astryxdesign/core/Toast'
import { type BookingSummary } from '@dp/core/api/contracts'
import { BODY_TYPE_LABELS } from '@dp/core/tenant/constants'
import { Camera, MessageSquareText, Pencil, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { StatusScreen } from '@/app/StatusScreen'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api/http'
import { dateWithYear, money, when } from '@/lib/format'
import { prepareImage } from '@/lib/image'
import { useTenant } from '@/tenant/TenantProvider'
import { useBookingFlow, type VehicleChoice } from '../booking/flow'
import { SheetFrame } from '@/components/SheetFrame'
import { ScreenHeader } from '@/components/ScreenHeader'
import { isUpcoming, useInvalidateClient, useProfile, useSaveVehicle } from '../data'
import { Card, Section } from '@/components/Section'
import { StatusBadge } from '@/components/StatusBadge'
import { VehicleGlyph } from '@/components/VehicleGlyph'
import { suggestionText } from './suggestions'
import { VehicleForm } from '@/components/VehicleForm'

export function VehicleDetailScreen() {
  const { id } = useParams()
  const { slug, api, tz, locale } = useTenant()
  const { profile, isFetching } = useProfile()
  const flow = useBookingFlow()
  const navigate = useNavigate()
  const invalidate = useInvalidateClient()
  const showToast = useToast()
  const save = useSaveVehicle()
  const fileRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const v = profile?.vehicles.find((x) => x.id === id)
  if (!v) {
    if (!profile && isFetching) return <Skeleton className="m-4 h-64 rounded-2xl" />
    return <StatusScreen title="Автомобиль не найден" text="Возможно, он удалён из гаража на этом устройстве." />
  }
  const choice: VehicleChoice = { kind: 'saved', id: v.id, body_type: v.body_type, label: v.nickname || `${v.make} ${v.model}` }
  const history = (profile?.bookings ?? []).filter((b) => b.vehicle_id === v.id)
  const upcoming = history.filter(isUpcoming)
  const past = history.filter((b) => !isUpcoming(b))

  const onPhoto = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setPhotoError(null)
    try {
      await api.uploadVehiclePhoto(v.id, await prepareImage(file))
      await invalidate()
    } catch (e) {
      setPhotoError(errorMessage(e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <ScreenHeader
        title={v.nickname || `${v.make} ${v.model}`}
        parent={`/s/${slug}/garage`}
        actions={
          <Button variant="ghost" size="icon" aria-label="Изменить данные автомобиля" onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
        }
      />
      <div className="mx-auto grid max-w-xl gap-6 px-4 pb-10">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-sunken">
          {v.photo?.url ? (
            <img src={v.photo.url} alt={`${v.make} ${v.model}`} className="aspect-[16/10] w-full object-cover" />
          ) : (
            <div className="grid aspect-[16/10] place-items-center">
              <VehicleGlyph className="h-20 w-48" />
            </div>
          )}
          <div className="absolute right-3 bottom-3">
            <Button size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
              <Camera /> {v.photo ? 'Заменить фото' : 'Добавить фото'}
            </Button>
            <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </div>
        </div>
        {photoError && <p className="text-sm text-danger">{photoError}</p>}

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Info label="Автомобиль" value={`${v.make} ${v.model}${v.generation ? ` (${v.generation})` : ''}`} />
          <Info label="Кузов" value={BODY_TYPE_LABELS[v.body_type]} />
          {v.year && <Info label="Год" value={String(v.year)} />}
          {v.color && <Info label="Цвет" value={v.color} />}
          {v.plate && <Info label="Госномер" value={v.plate} />}
          <Info label="В гараже с" value={dateWithYear(v.created_at, tz, locale)} />
        </div>

        <Button size="lg" block onClick={() => flow.start({ vehicle: choice })}>
          Записать этот автомобиль
        </Button>

        {v.suggestions.length > 0 && (
          <Section title="Рекомендации">
            <div className="grid gap-2">
              {v.suggestions.map((s) => (
                <Card key={s.service_id} className="flex items-center gap-3 p-3">
                  <Sparkles className="size-4 shrink-0 text-accent-text" aria-hidden />
                  <p className="flex-1 text-sm">{suggestionText(s)}</p>
                  <Button size="sm" variant="subtle" onClick={() => flow.start({ serviceId: s.service_id, vehicle: choice })}>
                    Записать
                  </Button>
                </Card>
              ))}
            </div>
          </Section>
        )}

        {upcoming.length > 0 && (
          <Section title="Предстоящие">
            <div className="grid gap-2">
              {upcoming.map((b) => (
                <HistoryRow key={b.id} b={b} />
              ))}
            </div>
          </Section>
        )}

        <Section title="История обслуживания">
          {past.length === 0 ? (
            <p className="rounded-xl bg-sunken p-4 text-sm text-fg-muted">Пока нет выполненных работ.</p>
          ) : (
            <div className="grid gap-2">
              {past.map((b) => (
                <HistoryRow key={b.id} b={b} onRepeat={b.status === 'completed' ? () => flow.start({ serviceId: b.service_id, vehicle: choice }) : undefined} />
              ))}
            </div>
          )}
        </Section>

        <Button variant="ghost" className="justify-self-center text-danger" onClick={() => setArchiving(true)}>
          <Trash2 /> Убрать из гаража
        </Button>
      </div>

      <BottomSheet isOpen={editing} onOpenChange={setEditing} label="Изменить автомобиль" height="tall" purpose="form">
        {editing && (
          <SheetFrame title="Данные автомобиля" onClose={() => setEditing(false)}>
            <VehicleForm
              initial={{ ...v, comment: v.comment }}
              submitLabel="Сохранить"
              busy={save.isPending}
              error={save.error ? errorMessage(save.error) : null}
              onSubmit={(val) => save.mutate(val, { onSuccess: () => (setEditing(false), showToast({ body: 'Сохранено' })) })}
            />
          </SheetFrame>
        )}
      </BottomSheet>
      <AlertDialog
        isOpen={archiving}
        onOpenChange={setArchiving}
        title="Убрать автомобиль из гаража?"
        description="История визитов останется у студии, но исчезнет из гаража на этом устройстве."
        actionLabel="Убрать"
        cancelLabel="Отмена"
        onAction={async () => {
          await api.archiveVehicle(v.id)
          await invalidate()
          setArchiving(false)
          navigate(`/s/${slug}/garage`, { replace: true })
        }}
      />
    </>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid">
      <span className="text-fg-subtle">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function HistoryRow({ b, onRepeat }: { b: BookingSummary; onRepeat?: () => void }) {
  const { slug, tz, locale, currency } = useTenant()
  return (
    <Card className="grid gap-3 p-3.5">
      <Link to={`/s/${slug}/history/${b.id}`} className="flex items-start justify-between gap-3 outline-none">
        <div className="grid gap-1">
          <p className="font-medium">{b.service_name}</p>
          <p className="text-sm text-fg-muted first-letter:uppercase">{when(b.starts_at, tz, locale)}</p>
        </div>
        <div className="grid justify-items-end gap-1">
          <span className="text-sm font-semibold tabular">{money(b.price_cents, b.currency || currency, locale)}</span>
          <StatusBadge status={b.status} />
        </div>
      </Link>
      {b.client_note && (
        <p className="flex gap-2 rounded-lg bg-sunken p-2.5 text-sm text-fg-muted">
          <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden /> {b.client_note}
        </p>
      )}
      {b.media.length > 0 && (
        <div className="scroll-x flex gap-2">
          {b.media.map((m) => (
            <figure key={m.id} className="shrink-0">
              {m.url && <img src={m.url} alt={m.alt || (m.kind === 'before' ? 'До' : 'После')} className="h-24 w-32 rounded-lg object-cover" loading="lazy" />}
              <figcaption className="mt-1 text-xs text-fg-subtle">{m.kind === 'before' ? 'До' : m.kind === 'after' ? 'После' : m.caption}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {onRepeat && (
        <Button size="sm" variant="secondary" onClick={onRepeat} className="justify-self-start">
          <RotateCcw /> Повторить запись
        </Button>
      )}
    </Card>
  )
}
