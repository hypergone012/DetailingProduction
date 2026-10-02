import { CheckCircle2, CircleDashed } from 'lucide-react'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api/http'
import { dateWithYear } from '@/lib/format'
import { tenantQueryKey } from '@/tenant/TenantProvider'
import { rpc } from '../api/client'
import type { TenantRow } from '../api/types'
import { useOwner, useOwnerMutation, useReadiness } from '../data'

/** demo <-> live. Going live needs every readiness check (enforced again in SQL). */
export function StatusSection({ tenant }: { tenant: TenantRow }) {
  const { tenantId, slug, tz, locale, isOwner } = useOwner()
  const readiness = useReadiness()
  const setStatus = useOwnerMutation((status: 'demo' | 'live') => rpc('owner_set_status', { p_tenant: tenantId, p_status: status }), [tenantQueryKey(slug)])
  const live = tenant.status === 'live'
  return (
    <Section title="Режим работы">
      <div id="status" className="grid scroll-mt-20 gap-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className="flex items-center gap-2 font-semibold">
              {live ? 'Рабочий режим' : 'Демо-режим'}
              <Badge tone={live ? 'success' : 'warning'}>{live ? 'live' : 'demo'}</Badge>
            </p>
            <p className="text-sm text-fg-muted">
              {live
                ? `Студия принимает настоящие записи${tenant.live_since ? ` с ${dateWithYear(tenant.live_since, tz, locale)}` : ''}. Клиенты и вы получаете уведомления.`
                : 'Можно всё попробовать: записи помечаются как демо, уведомления не отправляются никому.'}
            </p>
          </div>
        </div>
        {!live && (
          <>
            {readiness.isPending ? (
              <Skeleton className="h-28 rounded-xl" />
            ) : readiness.data ? (
              <ul className="grid gap-2">
                {readiness.data.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 text-sm">
                    {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Готово" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-label="Не готово" />}
                    <span className={c.ok ? '' : 'text-fg-muted'}>{c.label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-danger">{errorMessage(readiness.error)}</p>
            )}
          </>
        )}
        {setStatus.error && <p role="alert" className="text-sm text-danger">{errorMessage(setStatus.error)}</p>}
        {isOwner ? (
          live ? (
            <Button variant="secondary" className="justify-self-start" loading={setStatus.isPending} onClick={() => setStatus.mutate('demo')}>
              Вернуть в демо-режим
            </Button>
          ) : (
            <Button className="justify-self-start" disabled={!readiness.data?.ready} loading={setStatus.isPending} onClick={() => setStatus.mutate('live')}>
              Перейти в рабочий режим
            </Button>
          )
        ) : (
          <p className="text-xs text-fg-subtle">Режим меняет владелец студии.</p>
        )}
      </div>
    </Section>
  )
}
