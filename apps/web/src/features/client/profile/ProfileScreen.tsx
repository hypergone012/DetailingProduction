import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { useToast } from '@astryxdesign/core/Toast'
import { useQueryClient } from '@tanstack/react-query'
import { LogOut, MapPin, Phone } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { errorMessage } from '@/lib/api/http'
import { device } from '@/lib/device'
import { phonePretty } from '@/lib/format'
import { isValidPhone } from '@/lib/phone'
import { clearPrivateCaches } from '@/pwa/register'
import { useAppTheme } from '@/theme/ThemeProvider'
import { useTenant } from '@/tenant/TenantProvider'
import { ScreenHeader } from '@/components/ScreenHeader'
import { useInvalidateClient, useProfile } from '../data'
import { Card, Section } from '@/components/Section'
import { PhoneInput } from '@/components/PhoneInput'
import { AppearancePicker } from '@/components/AppearancePicker'
import { InstallCard } from './InstallCard'
import { PushCard } from './PushCard'

export function ProfileScreen() {
  const { slug, api, data, locale } = useTenant()
  const { motion, setMotion } = useAppTheme()
  const { profile, hasProfile } = useProfile()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const showToast = useToast()
  const [forgetOpen, setForgetOpen] = useState(false)
  const [forgetting, setForgetting] = useState(false)

  const forget = async () => {
    setForgetting(true)
    try {
      if (device.clientKey(slug)) await api.revokeProfile().catch(() => undefined)
    } finally {
      device.forget(slug)
      qc.removeQueries({ queryKey: ['client', slug] })
      clearPrivateCaches()
      setForgetting(false)
      setForgetOpen(false)
      showToast({ body: 'Данные удалены с этого устройства' })
      navigate(`/s/${slug}`, { replace: true })
    }
  }

  return (
    <>
      <ScreenHeader title="Профиль" large />
      <div className="mx-auto grid max-w-xl md:max-w-2xl gap-7 px-4 pt-2 pb-8">
        {hasProfile && profile ? <ContactCard key={profile.profile.id} /> : null}

        <Section title="Оформление">
          <Card className="grid gap-4 p-4">
            <AppearancePicker />
            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <div className="grid text-sm">
                <span className="font-medium">Анимации</span>
                <span className="text-fg-muted">«Меньше» отключает движение интерфейса</span>
              </div>
              <SegmentedControl label="Анимации" value={motion} onChange={(v) => setMotion(v as 'system' | 'reduce')} size="sm">
                <SegmentedControlItem value="system" label="Как в системе" />
                <SegmentedControlItem value="reduce" label="Меньше" />
              </SegmentedControl>
            </div>
          </Card>
        </Section>

        <Section title="Уведомления и приложение">
          <PushCard />
          <InstallCard name={data.tenant.name} />
        </Section>

        <Section title="Студия">
          <Card className="grid gap-3 p-4 text-sm">
            <p className="text-base font-semibold">{data.tenant.name}</p>
            {data.profile.address && (
              <a className="flex items-start gap-2 text-fg-muted" href={data.profile.map_url ?? undefined} target="_blank" rel="noreferrer">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {data.profile.address}
              </a>
            )}
            {data.profile.phone && (
              <a className="flex items-center gap-2 text-accent-text" href={`tel:${data.profile.phone}`}>
                <Phone className="size-4" aria-hidden /> {phonePretty(data.profile.phone)}
              </a>
            )}
          </Card>
        </Section>

        <Section title="Это устройство">
          <Card className="grid gap-3 p-4 text-sm">
            <p className="text-fg-muted">
              Гараж и история записей привязаны к этому устройству без регистрации. «Забыть устройство» удалит их отсюда; записи у студии сохранятся.
            </p>
            <Button variant="danger" onClick={() => setForgetOpen(true)} disabled={!device.clientKey(slug) && !device.contact(slug)}>
              <LogOut /> Забыть это устройство
            </Button>
          </Card>
        </Section>
        <p className="px-1 text-center text-xs text-fg-subtle">
          {data.tenant.status === 'demo' ? 'Демонстрационная студия: уведомления не отправляются. ' : ''}
          {locale === 'ru-RU' ? '' : locale}
        </p>
      </div>
      <AlertDialog
        isOpen={forgetOpen}
        onOpenChange={setForgetOpen}
        title="Забыть это устройство?"
        description="Гараж, история и доступ к записям будут удалены с этого телефона. Чтобы снова открыть запись, понадобится ссылка от студии."
        actionLabel="Забыть"
        cancelLabel="Отмена"
        onAction={forget}
        isActionLoading={forgetting}
      />
    </>
  )
}

function ContactCard() {
  const { api, locale } = useTenant()
  const { profile } = useProfile()
  const invalidate = useInvalidateClient()
  const showToast = useToast()
  const id = useId()
  const [name, setName] = useState(profile?.profile.display_name ?? '')
  const [phone, setPhone] = useState(phonePretty(profile?.profile.phone) ?? '')
  const [email, setEmail] = useState(profile?.profile.email ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const phoneOk = !phone || isValidPhone(phone, locale)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!phoneOk) return
    setBusy(true)
    setError(null)
    try {
      await api.updateContact({ name: name.trim() || undefined, phone: phone || undefined, email: email.trim() || null })
      await invalidate()
      showToast({ body: 'Контакты сохранены' })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title="Контакты">
      <Card className="p-4">
        <form className="grid gap-4" onSubmit={save} noValidate>
          <Field id={`${id}-n`} label="Имя">
            <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field id={`${id}-p`} label="Телефон" error={!phoneOk ? 'Проверьте номер' : null}>
            <PhoneInput id={`${id}-p`} value={phone} onValueChange={setPhone} locale={locale} />
          </Field>
          <Field id={`${id}-e`} label="Email">
            <Input id={`${id}-e`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" variant="secondary" loading={busy}>
            Сохранить
          </Button>
        </form>
      </Card>
    </Section>
  )
}
