import { BODY_TYPE_LABELS, BODY_TYPES, type BodyType } from '@dp/core/tenant/constants'
import { Camera, Plus } from 'lucide-react'
import { useId, useRef, useState, type FormEvent } from 'react'
import { Img } from '@/components/Img'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api/http'
import { tenantQueryKey, useTenant } from '@/tenant/TenantProvider'
import { rpc } from '../api/client'
import type { ResourceRow, ServiceRow } from '../api/types'
import { useOwner, useOwnerMutation } from '../data'
import { newEntityKey } from '../shared/keys'
import { MoneyInput } from '../shared/MoneyInput'
import { uploadImage } from '../shared/upload'

interface AddonDraft {
  id?: string
  key?: string
  name: string
  price_cents: number | null
  duration_min: number
  active: boolean
}

interface VariantDraft {
  on: boolean
  price_cents: number | null
  duration_min: number
}

export function ServiceEditor({ service, resources, onDone }: { service: ServiceRow | null; resources: ResourceRow[]; onDone: () => void }) {
  const { tenantId, slug } = useOwner()
  const { mediaFor } = useTenant()
  const id = useId()
  const types = [...new Set(resources.filter((r) => r.active).map((r) => r.type))]
  const [name, setName] = useState(service?.name ?? '')
  const [summary, setSummary] = useState(service?.summary ?? '')
  const [description, setDescription] = useState(service?.description ?? '')
  const [price, setPrice] = useState<number | null>(service?.price_cents ?? null)
  const [durationMin, setDurationMin] = useState(service?.duration_min ?? 60)
  const [before, setBefore] = useState(service?.buffer_before_min ?? 0)
  const [after, setAfter] = useState(service?.buffer_after_min ?? 15)
  const [multiDay, setMultiDay] = useState(service?.multi_day ?? false)
  const [confirm, setConfirm] = useState(service?.requires_confirmation ?? false)
  const [online, setOnline] = useState(service?.bookable_online ?? true)
  const [active, setActive] = useState(service?.active ?? true)
  const [resourceTypes, setResourceTypes] = useState<string[]>(service?.resource_types ?? types.slice(0, 1))
  const [variants, setVariants] = useState<Record<BodyType, VariantDraft>>(() =>
    Object.fromEntries(
      BODY_TYPES.map((b) => {
        const v = service?.service_variants.find((x) => x.body_type === b)
        return [b, { on: Boolean(v), price_cents: v?.price_cents ?? service?.price_cents ?? null, duration_min: v?.duration_min ?? service?.duration_min ?? 60 }]
      }),
    ) as Record<BodyType, VariantDraft>,
  )
  const [addons, setAddons] = useState<AddonDraft[]>(service?.service_addons.map((a) => ({ ...a })) ?? [])
  const [touched, setTouched] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)
  const photo = service ? mediaFor('service', service.id)[0] : undefined

  const durationOk = durationMin >= 5 && durationMin <= 20160
  const valid = name.trim() && price !== null && price >= 0 && durationOk && resourceTypes.length > 0 && addons.every((a) => a.name.trim() && a.price_cents !== null)

  const save = useOwnerMutation(
    () =>
      rpc('owner_save_service', {
        p_tenant: tenantId,
        p_service: {
          ...(service ? { id: service.id } : { key: newEntityKey(name) }),
          name: name.trim(),
          summary: summary.trim(),
          description: description.trim(),
          price_cents: price,
          duration_min: durationMin,
          buffer_before_min: before,
          buffer_after_min: after,
          multi_day: multiDay,
          requires_confirmation: confirm,
          bookable_online: online,
          active,
          resource_types: resourceTypes,
          variants: BODY_TYPES.filter((b) => variants[b].on && variants[b].price_cents !== null).map((b) => ({
            body_type: b,
            price_cents: variants[b].price_cents,
            duration_min: variants[b].duration_min,
          })),
          addons: addons.map((a, i) => ({
            ...(a.id ? { id: a.id } : { key: newEntityKey(a.name) }),
            name: a.name.trim(),
            price_cents: a.price_cents,
            duration_min: a.duration_min,
            active: a.active,
            sort_order: i,
          })),
        },
      }),
    [tenantQueryKey(slug)],
  )

  const uploadPhoto = useOwnerMutation(
    async (file: File) => {
      const up = await uploadImage(tenantId, 'public-media', 'services', file, 1280)
      // Newest first: the client shows the lowest sort_order.
      await rpc('owner_register_media', {
        p_tenant: tenantId,
        p_media: { kind: 'service', bucket: 'public-media', path: up.path, width: up.width, height: up.height, service_id: service!.id, alt: name, sort_order: -Math.floor(Date.now() / 1000) },
      })
    },
    [tenantQueryKey(slug)],
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!valid) return
    save.mutate(undefined, { onSuccess: onDone })
  }

  return (
    <form className="grid gap-5 px-4 pb-8" onSubmit={submit} noValidate>
      <Field id={`${id}-name`} label="Название" error={touched && !name.trim() ? 'Укажите название' : null}>
        <Input id={`${id}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id={`${id}-summary`} label="Коротко">
        <Input id={`${id}-summary`} value={summary} maxLength={200} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field id={`${id}-desc`} label="Описание">
        <Textarea id={`${id}-desc`} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${id}-price`} label="Цена, ₽" error={touched && price === null ? 'Укажите цену' : null}>
          <MoneyInput id={`${id}-price`} cents={price} onCents={setPrice} />
        </Field>
        <Field id={`${id}-dur`} label={multiDay ? 'Работа, мин (всего)' : 'Длительность, мин'} error={!durationOk ? 'От 5 минут' : null}>
          <Input id={`${id}-dur`} inputMode="numeric" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value.replace(/\D/g, '')) || 0)} />
        </Field>
        <Field id={`${id}-before`} label="Подготовка до, мин">
          <Input id={`${id}-before`} inputMode="numeric" value={before} onChange={(e) => setBefore(Math.min(240, Number(e.target.value.replace(/\D/g, '')) || 0))} />
        </Field>
        <Field id={`${id}-after`} label="Уборка после, мин">
          <Input id={`${id}-after`} inputMode="numeric" value={after} onChange={(e) => setAfter(Math.min(240, Number(e.target.value.replace(/\D/g, '')) || 0))} />
        </Field>
      </div>
      <div className="grid gap-3 rounded-2xl border border-line p-4">
        <Toggle checked={multiDay} onChange={setMultiDay} label="Несколько дней" hint="Работа идёт по рабочим часам, бокс занят непрерывно" />
        <Toggle checked={confirm} onChange={setConfirm} label="Нужно подтверждение студии" />
        <Toggle checked={online} onChange={setOnline} label="Доступна для онлайн-записи" />
        <Toggle checked={active} onChange={setActive} label="Активна" hint="Скрытая услуга не видна клиентам и недоступна для записи" />
      </div>

      <div className="grid gap-2">
        <Label>Где выполняется</Label>
        {types.length === 0 ? (
          <p className="text-sm text-danger">Сначала добавьте ресурсы (боксы, посты) в разделе «Студия → Расписание и ресурсы».</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {types.map((t) => {
              const on = resourceTypes.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => setResourceTypes((xs) => (on ? xs.filter((x) => x !== t) : [...xs, t]))}
                  className={`rounded-full border px-3 py-1.5 text-sm ${on ? 'border-accent-text bg-accent-subtle' : 'border-line'}`}
                >
                  {resources.filter((r) => r.type === t).map((r) => r.name).join(', ')}
                </button>
              )
            })}
          </div>
        )}
        {touched && resourceTypes.length === 0 && <p className="text-sm text-danger">Выберите хотя бы один тип ресурса</p>}
      </div>

      <div className="grid gap-2">
        <Label>Цена по типу кузова</Label>
        <p className="text-xs text-fg-subtle">Без отметки действует базовая цена и длительность.</p>
        {BODY_TYPES.map((b) => (
          <div key={b} className="grid grid-cols-[1fr_96px_84px] items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={variants[b].on} onCheckedChange={(on) => setVariants((v) => ({ ...v, [b]: { ...v[b], on } }))} aria-label={BODY_TYPE_LABELS[b]} />
              {BODY_TYPE_LABELS[b]}
            </label>
            <MoneyInput aria-label={`Цена: ${BODY_TYPE_LABELS[b]}`} disabled={!variants[b].on} cents={variants[b].price_cents} onCents={(c) => setVariants((v) => ({ ...v, [b]: { ...v[b], price_cents: c } }))} className="h-10" />
            <Input
              aria-label={`Минут: ${BODY_TYPE_LABELS[b]}`}
              disabled={!variants[b].on}
              inputMode="numeric"
              className="h-10"
              value={variants[b].duration_min}
              onChange={(e) => setVariants((v) => ({ ...v, [b]: { ...v[b], duration_min: Number(e.target.value.replace(/\D/g, '')) || 0 } }))}
            />
          </div>
        ))}
      </div>

      <div className="grid gap-2">
        <Label>Дополнительные услуги</Label>
        {addons.map((a, i) => (
          <div key={a.id ?? i} className="grid grid-cols-[1fr_96px_72px_auto] items-center gap-2">
            <Input aria-label="Название допуслуги" value={a.name} maxLength={80} onChange={(e) => setAddons((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="h-10" />
            <MoneyInput aria-label="Цена допуслуги" cents={a.price_cents} onCents={(c) => setAddons((xs) => xs.map((x, j) => (j === i ? { ...x, price_cents: c } : x)))} className="h-10" />
            <Input aria-label="Минут" inputMode="numeric" value={a.duration_min} onChange={(e) => setAddons((xs) => xs.map((x, j) => (j === i ? { ...x, duration_min: Number(e.target.value.replace(/\D/g, '')) || 0 } : x)))} className="h-10" />
            <Switch aria-label="Активна" checked={a.active} onCheckedChange={(on) => setAddons((xs) => xs.map((x, j) => (j === i ? { ...x, active: on } : x)))} />
          </div>
        ))}
        <Button type="button" variant="ghost" className="justify-self-start" onClick={() => setAddons((xs) => [...xs, { name: '', price_cents: null, duration_min: 0, active: true }])}>
          <Plus /> Допуслуга
        </Button>
      </div>

      {service && (
        <div className="grid gap-2">
          <Label>Фото</Label>
          <div className="flex items-center gap-3">
            <Img media={photo} sizes="96px" className="size-20 shrink-0 rounded-xl" alt="" />
            <Button type="button" variant="secondary" size="sm" loading={uploadPhoto.isPending} onClick={() => photoRef.current?.click()}>
              <Camera /> Загрузить
            </Button>
            <input
              ref={photoRef}
              type="file"
              aria-label="Загрузить фото услуги"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) uploadPhoto.mutate(f)
                e.target.value = ''
              }}
            />
          </div>
          {uploadPhoto.error && <p className="text-sm text-danger">{errorMessage(uploadPhoto.error)}</p>}
        </div>
      )}

      {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
      <Button type="submit" size="lg" block loading={save.isPending}>
        Сохранить
      </Button>
    </form>
  )
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start justify-between gap-3">
      <span className="grid gap-0.5">
        <span className="text-[15px]">{label}</span>
        {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}
