import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, BellRing, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { device } from '@/lib/device'
import { pushState, subscribePush, unsubscribePush, type PushState } from '@/lib/push'
import { cn } from '@/lib/utils'
import { useTenant } from '@/tenant/TenantProvider'
import { keys } from '../data'

const TEXT: Record<PushState['kind'], string> = {
  unsupported: 'Этот браузер не поддерживает push-уведомления. Напоминания о визите будут видны в приложении.',
  'needs-install': '',
  'disabled-by-studio': 'Студия пока не отправляет push-уведомления.',
  'no-service-worker': 'Уведомления заработают после установки приложения или перезагрузки страницы.',
  denied: 'Уведомления запрещены в настройках браузера. Разрешите их для этого сайта, чтобы получать напоминания.',
  available: 'Напомним о визите и сообщим, если студия перенесёт или подтвердит запись.',
  subscribed: 'Уведомления включены на этом устройстве.',
}

/**
 * Push status of THIS device, verified (permission + an actual PushSubscription accepted by
 * the server). Never says "enabled" unless it really is.
 */
export function PushCard({ compact = false }: { compact?: boolean }) {
  const { slug, api, data } = useTenant()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const q = useQuery({
    queryKey: keys.push(slug),
    queryFn: async () => {
      const cfg = await api.pushConfig()
      return { cfg, state: await pushState(cfg.enabled && data.capabilities.push) }
    },
    staleTime: 0,
  })
  if (!q.data) return null
  const { cfg } = q.data
  // A demo studio never sends notifications, so it never offers to subscribe.
  const demo = data.tenant.status === 'demo'
  const state: PushState = demo ? { kind: 'disabled-by-studio' } : q.data.state
  if (compact && (state.kind === 'unsupported' || state.kind === 'disabled-by-studio')) return null
  const hasAuth = Boolean(device.clientKey(slug))

  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      const sub = await subscribePush(cfg.vapid_public_key!)
      await api.pushSubscribe(sub.toJSON())
      await qc.invalidateQueries({ queryKey: keys.push(slug) })
    } catch (e) {
      setError(e instanceof Error && e.message === 'permission' ? 'Разрешение не выдано.' : 'Не удалось включить уведомления. Попробуйте ещё раз.')
      await qc.invalidateQueries({ queryKey: keys.push(slug) })
    } finally {
      setBusy(false)
    }
  }
  const disable = async () => {
    setBusy(true)
    try {
      const endpoint = await unsubscribePush()
      if (endpoint) await api.pushUnsubscribe(endpoint)
    } finally {
      setBusy(false)
      await qc.invalidateQueries({ queryKey: keys.push(slug) })
    }
  }

  const Icon = state.kind === 'subscribed' ? BellRing : state.kind === 'needs-install' ? Smartphone : state.kind === 'available' ? Bell : BellOff
  return (
    <div className={cn('grid gap-3 rounded-2xl border border-line p-4', compact ? 'bg-bg-elevated' : 'bg-surface')}>
      <div className="flex gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5', state.kind === 'subscribed' ? 'bg-success-subtle text-success' : 'bg-surface-2 text-fg-muted')}>
          <Icon aria-hidden />
        </span>
        <div className="grid gap-1 text-sm">
          <p className="font-medium text-fg">Уведомления</p>
          <p className="text-fg-muted">{state.kind === 'needs-install' || state.kind === 'unsupported' ? state.reason : demo ? 'Это демо-версия студии: уведомления не отправляются.' : TEXT[state.kind]}</p>
        </div>
      </div>
      {state.kind === 'available' && hasAuth && (
        <Button variant="subtle" onClick={enable} loading={busy}>
          Включить уведомления
        </Button>
      )}
      {state.kind === 'subscribed' && !compact && (
        <Button variant="ghost" onClick={disable} loading={busy}>
          Выключить на этом устройстве
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
