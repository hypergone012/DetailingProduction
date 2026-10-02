import { useId, useState, type FormEvent } from 'react'
import { PhoneInput } from '@/components/PhoneInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api/http'
import { phonePretty } from '@/lib/format'
import { isValidPhone } from '@/lib/phone'
import { rpc, toE164 } from '../api/client'
import type { CustomerRow } from '../api/types'
import { useOwner, useOwnerMutation } from '../data'

/** Create or edit a customer (owner_save_customer). Phone is unique per studio. */
export function CustomerForm({ initial, onSaved }: { initial?: CustomerRow; onSaved: (id: string) => void }) {
  const { tenantId, locale } = useOwner()
  const id = useId()
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone_e164 ? phonePretty(initial.phone_e164) : '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [notes, setNotes] = useState(initial?.owner_notes ?? '')
  const [touched, setTouched] = useState(false)
  const phoneOk = !phone.replace(/[+\s]/g, '') || isValidPhone(phone, locale)
  const save = useOwnerMutation(() =>
    rpc<{ id: string }>('owner_save_customer', {
      p_tenant: tenantId,
      p_customer: { ...(initial ? { id: initial.id } : {}), name: name.trim(), phone: toE164(phone) ?? '', email: email.trim(), owner_notes: notes },
    }),
  )
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!name.trim() || !phoneOk) return
    save.mutate(undefined, { onSuccess: (r) => onSaved(r.id) })
  }
  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <Field id={`${id}-name`} label="Имя" error={touched && !name.trim() ? 'Укажите имя' : null}>
        <Input id={`${id}-name`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id={`${id}-phone`} label="Телефон" error={touched && !phoneOk ? 'Проверьте номер' : null}>
        <PhoneInput id={`${id}-phone`} value={phone} onValueChange={setPhone} locale={locale} />
      </Field>
      <Field id={`${id}-email`} label="Email">
        <Input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field id={`${id}-notes`} label="Заметки о клиенте" hint="Видны только сотрудникам">
        <Textarea id={`${id}-notes`} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
      <Button type="submit" size="lg" block loading={save.isPending}>
        Сохранить
      </Button>
    </form>
  )
}
