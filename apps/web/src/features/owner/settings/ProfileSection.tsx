import { useId, useState, type FormEvent } from 'react'
import { PhoneInput } from '@/components/PhoneInput'
import { Card, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api/http'
import { phonePretty } from '@/lib/format'
import { isValidPhone } from '@/lib/phone'
import { tenantQueryKey } from '@/tenant/TenantProvider'
import { rpc, toE164 } from '../api/client'
import type { SettingsRow, TenantRow } from '../api/types'
import { useOwner, useOwnerMutation } from '../data'

const HTTPS = /^https:\/\/\S+$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

export function ProfileSection({ tenant, settings }: { tenant: TenantRow; settings: SettingsRow }) {
  const { tenantId, slug, locale } = useOwner()
  const id = useId()
  const [name, setName] = useState(tenant.name)
  const [tagline, setTagline] = useState(settings.tagline)
  const [description, setDescription] = useState(settings.description)
  const [address, setAddress] = useState(settings.address)
  const [phone, setPhone] = useState(settings.phone ? phonePretty(settings.phone) : '')
  const [email, setEmail] = useState(settings.email ?? '')
  const [website, setWebsite] = useState(settings.website ?? '')
  const [mapUrl, setMapUrl] = useState(settings.map_url ?? '')
  const [touched, setTouched] = useState(false)
  const problems = {
    name: !name.trim() ? 'Укажите название' : null,
    phone: phone.replace(/[+\s]/g, '') && !isValidPhone(phone, locale) ? 'Проверьте номер' : null,
    email: email.trim() && !EMAIL.test(email.trim()) ? 'Проверьте email' : null,
    website: website.trim() && !HTTPS.test(website.trim()) ? 'Адрес должен начинаться с https://' : null,
    map: mapUrl.trim() && !HTTPS.test(mapUrl.trim()) ? 'Ссылка должна начинаться с https://' : null,
  }
  const save = useOwnerMutation(async () => {
    if (name.trim() !== tenant.name) await rpc('owner_update_tenant', { p_tenant: tenantId, p_patch: { name: name.trim() } })
    await rpc('owner_update_settings', {
      p_tenant: tenantId,
      p_patch: {
        tagline: tagline.trim(),
        description: description.trim(),
        address: address.trim(),
        phone: toE164(phone) ?? '',
        email: email.trim(),
        website: website.trim(),
        map_url: mapUrl.trim(),
      },
    })
  }, [tenantQueryKey(slug)])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (Object.values(problems).some(Boolean)) return
    save.mutate(undefined)
  }
  return (
    <Section title="Профиль студии">
      <Card className="p-4">
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <Field id={`${id}-name`} label="Название" error={touched ? problems.name : null}>
            <Input id={`${id}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id={`${id}-tagline`} label="Слоган">
            <Input id={`${id}-tagline`} value={tagline} maxLength={160} onChange={(e) => setTagline(e.target.value)} />
          </Field>
          <Field id={`${id}-desc`} label="О студии">
            <Textarea id={`${id}-desc`} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field id={`${id}-address`} label="Адрес">
            <Input id={`${id}-address`} value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-phone`} label="Телефон" error={touched ? problems.phone : null}>
              <PhoneInput id={`${id}-phone`} value={phone} onValueChange={setPhone} locale={locale} />
            </Field>
            <Field id={`${id}-email`} label="Email" error={touched ? problems.email : null}>
              <Input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field id={`${id}-site`} label="Сайт" error={touched ? problems.website : null}>
              <Input id={`${id}-site`} type="url" value={website} placeholder="https://" onChange={(e) => setWebsite(e.target.value)} />
            </Field>
            <Field id={`${id}-map`} label="Ссылка на карту" error={touched ? problems.map : null}>
              <Input id={`${id}-map`} type="url" value={mapUrl} placeholder="https://yandex.ru/maps/…" onChange={(e) => setMapUrl(e.target.value)} />
            </Field>
          </div>
          {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
          {save.isSuccess && !save.isPending && <p className="text-sm text-success">Сохранено</p>}
          <Button type="submit" className="justify-self-start" loading={save.isPending}>
            Сохранить профиль
          </Button>
        </form>
      </Card>
      <SlugCard current={tenant.slug} />
    </Section>
  )
}

function SlugCard({ current }: { current: string }) {
  const { tenantId } = useOwner()
  const id = useId()
  const [value, setValue] = useState(current)
  const next = value.trim().toLowerCase()
  const valid = SLUG.test(next)
  const change = useOwnerMutation(() => rpc<{ slug: string }>('owner_update_tenant', { p_tenant: tenantId, p_patch: { slug: next } }))
  return (
    <Card className="grid gap-3 p-4">
      <Field id={`${id}-slug`} label="Адрес страницы" hint={`${window.location.origin}/s/${next || '…'}`} error={next && !valid ? 'Латиница, цифры и дефис, до 40 символов' : null}>
        <Input id={`${id}-slug`} value={value} maxLength={40} onChange={(e) => setValue(e.target.value)} autoCapitalize="none" autoCorrect="off" />
      </Field>
      {next !== current && valid && (
        <p className="rounded-xl bg-warning-subtle p-3 text-sm">
          Старые ссылки, QR-коды и установленные приложения перестанут открываться. Клиентам с сохранёнными записями понадобится новая ссылка.
        </p>
      )}
      {change.error && <p role="alert" className="text-sm text-danger">{errorMessage(change.error)}</p>}
      <Button
        variant="secondary"
        className="justify-self-start"
        disabled={!valid || next === current}
        loading={change.isPending}
        onClick={() => change.mutate(undefined, { onSuccess: (r) => window.location.assign(`/s/${r.slug}/owner/settings`) })}
      >
        Сменить адрес
      </Button>
    </Card>
  )
}
