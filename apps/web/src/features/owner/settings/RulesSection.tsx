import { useId, useState } from 'react'
import { Card, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { errorMessage } from '@/lib/api/http'
import { tenantQueryKey } from '@/tenant/TenantProvider'
import { rpc } from '../api/client'
import type { SettingsRow } from '../api/types'
import { useOwner, useOwnerMutation } from '../data'

const STEPS = [5, 10, 15, 20, 30, 60]

/** Online booking rules; the SQL engine reads exactly these values. */
export function RulesSection({ settings }: { settings: SettingsRow }) {
  const { tenantId, slug } = useOwner()
  const id = useId()
  const [step, setStep] = useState(settings.slot_step_min)
  const [noticeH, setNoticeH] = useState(Math.round(settings.min_notice_min / 60))
  const [horizon, setHorizon] = useState(settings.horizon_days)
  const [cutoff, setCutoff] = useState(settings.cancel_cutoff_hours)
  const [confirm, setConfirm] = useState(settings.requires_confirmation)
  const [maxActive, setMaxActive] = useState(settings.max_active_bookings_per_phone)
  const [reminder, setReminder] = useState(settings.reminder_hours_before)
  const num = (v: string) => Number(v.replace(/\D/g, '')) || 0
  const problems = [
    noticeH > 168 && 'Минимум до записи — не больше 168 ч',
    (horizon < 1 || horizon > 365) && 'Горизонт — от 1 до 365 дней',
    cutoff > 336 && 'Срок переноса — не больше 336 ч',
    (maxActive < 1 || maxActive > 50) && 'Активных записей на номер — от 1 до 50',
    (reminder < 1 || reminder > 168) && 'Напоминание — от 1 до 168 ч',
  ].filter(Boolean) as string[]
  const save = useOwnerMutation(
    () =>
      rpc('owner_update_settings', {
        p_tenant: tenantId,
        p_patch: {
          slot_step_min: step,
          min_notice_min: noticeH * 60,
          horizon_days: horizon,
          cancel_cutoff_hours: cutoff,
          requires_confirmation: confirm,
          max_active_bookings_per_phone: maxActive,
          reminder_hours_before: reminder,
        },
      }),
    [tenantQueryKey(slug)],
  )
  return (
    <Section title="Правила онлайн-записи">
      <Card className="grid gap-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-step`} label="Шаг времени">
            <Select value={String(step)} onValueChange={(v) => setStep(Number(v))}>
              <SelectTrigger id={`${id}-step`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STEPS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    каждые {s} мин
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id={`${id}-notice`} label="Запись не позже чем за, ч">
            <Input id={`${id}-notice`} inputMode="numeric" value={noticeH} onChange={(e) => setNoticeH(num(e.target.value))} />
          </Field>
          <Field id={`${id}-horizon`} label="Запись вперёд на, дней">
            <Input id={`${id}-horizon`} inputMode="numeric" value={horizon} onChange={(e) => setHorizon(num(e.target.value))} />
          </Field>
          <Field id={`${id}-cutoff`} label="Перенос и отмена клиентом за, ч">
            <Input id={`${id}-cutoff`} inputMode="numeric" value={cutoff} onChange={(e) => setCutoff(num(e.target.value))} />
          </Field>
          <Field id={`${id}-max`} label="Активных записей на один телефон">
            <Input id={`${id}-max`} inputMode="numeric" value={maxActive} onChange={(e) => setMaxActive(num(e.target.value))} />
          </Field>
          <Field id={`${id}-reminder`} label="Напомнить клиенту за, ч">
            <Input id={`${id}-reminder`} inputMode="numeric" value={reminder} onChange={(e) => setReminder(num(e.target.value))} />
          </Field>
        </div>
        <label className="flex items-start justify-between gap-3">
          <span className="grid gap-0.5">
            <span className="text-[15px]">Подтверждать каждую онлайн-запись</span>
            <span className="text-xs text-fg-subtle">Время всё равно резервируется сразу, клиент видит статус «ждёт подтверждения»</span>
          </span>
          <Switch checked={confirm} onCheckedChange={setConfirm} />
        </label>
        {problems.map((p) => (
          <p key={p} className="text-sm text-danger">
            {p}
          </p>
        ))}
        {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
        {save.isSuccess && !save.isPending && <p className="text-sm text-success">Сохранено</p>}
        <Button className="justify-self-start" disabled={problems.length > 0} loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Сохранить правила
        </Button>
      </Card>
    </Section>
  )
}
