import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, BellRing, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { Card, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { SavingSwitch } from '@/components/ui/switch'
import { errorMessage } from '@/lib/api/http'
import { pushState, subscribePush, unsubscribePush } from '@/lib/push'
import { useTenant } from '@/tenant/TenantProvider'
import { rpc } from '../api/client'
import type { SettingsRow } from '../api/types'
import { useOwner, useOwnerMutation } from '../data'

export function NotificationsSection({ settings }: { settings: SettingsRow }) {
  const { tenantId, isOwner } = useOwner()
  const { data } = useTenant()
  const save = useOwnerMutation((patch: Record<string, boolean>) => rpc('owner_update_settings', { p_tenant: tenantId, p_patch: patch }))
  return (
    <Section title="Уведомления">
      {data.tenant.status === 'demo' && <p className="-mt-1 px-1 text-sm text-warning">Демо-режим: уведомления не отправляются, даже если всё включено.</p>}
      {isOwner && (
        <Card className="grid gap-3 p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="text-[15px]">Клиентам: подтверждения, переносы, напоминания</span>
            <SavingSwitch checked={settings.notify_client_push} onSave={(v) => save.mutateAsync({ notify_client_push: v })} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-[15px]">Студии: новые записи, переносы, отмены</span>
            <SavingSwitch checked={settings.notify_owner_push} onSave={(v) => save.mutateAsync({ notify_owner_push: v })} />
          </label>
          {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
        </Card>
      )}
      <DevicePush />
    </Section>
  )
}

/** Push to THIS device for the signed-in staff member; the state is verified, never assumed. */
function DevicePush() {
  const { tenantId } = useOwner()
  const { api, data } = useTenant()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const q = useQuery({
    queryKey: ['owner', tenantId, 'device-push'],
    queryFn: async () => {
      const cfg = await api.pushConfig()
      return { cfg, state: await pushState(cfg.enabled && data.capabilities.push) }
    },
    staleTime: 0,
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['owner', tenantId, 'device-push'] })
  if (!q.data) return null
  const { cfg, state } = q.data
  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      const sub = await subscribePush(cfg.vapid_public_key!)
      await rpc('owner_push_subscribe', { p_tenant: tenantId, p_subscription: sub.toJSON(), p_user_agent: navigator.userAgent })
    } catch (e) {
      setError(e instanceof Error && e.message === 'permission' ? 'Разрешение не выдано.' : errorMessage(e))
    } finally {
      setBusy(false)
      await refresh()
    }
  }
  const disable = async () => {
    setBusy(true)
    try {
      const endpoint = await unsubscribePush()
      if (endpoint) await rpc('owner_push_unsubscribe', { p_tenant: tenantId, p_endpoint: endpoint })
    } finally {
      setBusy(false)
      await refresh()
    }
  }
  const text: Record<string, string> = {
    'disabled-by-studio': 'Push-уведомления на сервере не настроены (нет VAPID-ключей).',
    'no-service-worker': 'Уведомления заработают после установки приложения или перезагрузки страницы.',
    denied: 'Уведомления запрещены в настройках браузера для этого сайта.',
    available: 'Получайте новые записи и отмены на это устройство.',
    subscribed: 'Это устройство получает уведомления студии.',
  }
  const Icon = state.kind === 'subscribed' ? BellRing : state.kind === 'needs-install' ? Smartphone : state.kind === 'available' ? Bell : BellOff
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />
        <div className="grid gap-1 text-sm">
          <p className="font-medium">Это устройство</p>
          <p className="text-fg-muted">{state.kind === 'needs-install' || state.kind === 'unsupported' ? state.reason : text[state.kind]}</p>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {state.kind === 'available' && (
        <Button className="justify-self-start" loading={busy} onClick={() => void enable()}>
          Включить на этом устройстве
        </Button>
      )}
      {state.kind === 'subscribed' && (
        <Button variant="secondary" className="justify-self-start" loading={busy} onClick={() => void disable()}>
          Выключить
        </Button>
      )}
    </Card>
  )
}
