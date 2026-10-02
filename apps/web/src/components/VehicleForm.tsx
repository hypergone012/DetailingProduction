import { type VehicleInput } from '@dp/core/api/contracts'
import { BODY_TYPE_LABELS, type BodyType } from '@dp/core/tenant/constants'
import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BodyTypePicker } from '@/components/BodyTypePicker'

const MAKES = ['Audi', 'BMW', 'Chery', 'Exeed', 'Geely', 'Haval', 'Honda', 'Hyundai', 'Infiniti', 'Kia', 'Land Rover', 'Lexus', 'Lada', 'Mazda', 'Mercedes-Benz', 'Mitsubishi', 'Nissan', 'Porsche', 'Renault', 'Skoda', 'Tank', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo', 'Zeekr']

export interface VehicleFormValue extends VehicleInput {
  id?: string
}

/** Minimal vehicle form: make, model and body type are enough; the rest is optional. */
export function VehicleForm({
  initial,
  allowed,
  submitLabel,
  onSubmit,
  busy,
  error,
  compact = false,
}: {
  initial?: Partial<VehicleFormValue>
  allowed?: BodyType[] | null
  submitLabel: string
  onSubmit: (v: VehicleFormValue) => void
  busy?: boolean
  error?: string | null
  compact?: boolean
}) {
  const id = useId()
  const [make, setMake] = useState(initial?.make ?? '')
  const [model, setModel] = useState(initial?.model ?? '')
  const [body, setBody] = useState<BodyType | null>(initial?.body_type ?? null)
  const [year, setYear] = useState(initial?.year ? String(initial.year) : '')
  const [color, setColor] = useState(initial?.color ?? '')
  const [plate, setPlate] = useState(initial?.plate ?? '')
  const [nickname, setNickname] = useState(initial?.nickname ?? '')
  const [comment, setComment] = useState(initial?.comment ?? '')
  const [touched, setTouched] = useState(false)
  const yearNum = year ? Number(year) : null
  const yearBad = yearNum !== null && (!Number.isInteger(yearNum) || yearNum < 1950 || yearNum > new Date().getFullYear() + 1)
  const valid = make.trim() && model.trim() && body && !yearBad

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!valid) return
    onSubmit({
      ...(initial?.id ? { id: initial.id } : {}),
      make: make.trim(),
      model: model.trim(),
      body_type: body!,
      year: yearNum,
      color: color.trim() || null,
      plate: plate.trim() || null,
      nickname: nickname.trim() || null,
      comment: comment.trim(),
    })
  }

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${id}-make`} label="Марка" error={touched && !make.trim() ? 'Укажите марку' : null}>
          <Input id={`${id}-make`} list={`${id}-makes`} value={make} onChange={(e) => setMake(e.target.value)} autoComplete="off" aria-invalid={touched && !make.trim()} required />
          <datalist id={`${id}-makes`}>
            {MAKES.map((mk) => (
              <option key={mk} value={mk} />
            ))}
          </datalist>
        </Field>
        <Field id={`${id}-model`} label="Модель" error={touched && !model.trim() ? 'Укажите модель' : null}>
          <Input id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" aria-invalid={touched && !model.trim()} required />
        </Field>
      </div>
      <div className="grid gap-2">
        <Label id={`${id}-body`}>Тип кузова</Label>
        <BodyTypePicker id={`${id}-body`} value={body} onChange={setBody} allowed={allowed} />
        {touched && !body && <p className="text-sm text-danger">Выберите тип кузова — от него зависит цена</p>}
        {body && allowed && !allowed.includes(body) && <p className="text-sm text-warning">Эта услуга не выполняется для типа «{BODY_TYPE_LABELS[body]}»</p>}
      </div>
      {!compact && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-year`} label="Год (необязательно)" error={yearBad ? 'Некорректный год' : null}>
              <Input id={`${id}-year`} inputMode="numeric" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field id={`${id}-color`} label="Цвет">
              <Input id={`${id}-color`} value={color} onChange={(e) => setColor(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-plate`} label="Госномер" hint="Хранится только у студии">
              <Input id={`${id}-plate`} value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} autoCapitalize="characters" />
            </Field>
            <Field id={`${id}-nick`} label="Как назвать">
              <Input id={`${id}-nick`} value={nickname} placeholder="Например, Белая" onChange={(e) => setNickname(e.target.value)} />
            </Field>
          </div>
          <Field id={`${id}-comment`} label="Комментарий для студии">
            <Textarea id={`${id}-comment`} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder="Сколы, особенности, пожелания" />
          </Field>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" block loading={busy}>
        {submitLabel}
      </Button>
    </form>
  )
}
