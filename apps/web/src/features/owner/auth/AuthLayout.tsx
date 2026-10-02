import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { useTenant } from '@/tenant/TenantProvider'

/** Centered card with the studio's identity, shared by sign-in screens. */
export function AuthLayout({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  const { data, mediaByKey, mediaFor } = useTenant()
  const logo = mediaByKey(data.branding.logoKey) ?? mediaFor('logo')[0]
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10" style={{ paddingTop: 'calc(var(--dp-safe-top) + 40px)' }}>
      <div className="grid w-full max-w-sm gap-6">
        <div className="grid justify-items-center gap-3 text-center">
          {logo?.url && <img src={logo.url} alt="" className="size-16 rounded-2xl border border-line bg-surface object-contain p-2" />}
          <div className="grid gap-1">
            <p className="text-sm text-fg-muted">Кабинет студии</p>
            <p className="flex items-center justify-center gap-2 text-lg font-semibold">
              {data.tenant.name}
              {data.tenant.status === 'demo' && <Badge tone="warning">Демо</Badge>}
            </p>
          </div>
        </div>
        <div className="grid gap-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div className="grid gap-1">
            <h1 className="text-xl font-semibold">{title}</h1>
            {text && <p className="text-sm text-fg-muted">{text}</p>}
          </div>
          {children}
        </div>
      </div>
    </main>
  )
}
