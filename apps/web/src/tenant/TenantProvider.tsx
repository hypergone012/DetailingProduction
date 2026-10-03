import type { Bootstrap, MediaView, ServiceView } from '@dp/core/api/contracts'
import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { publicApi, type PublicApi } from '@/lib/api/public'
import { ApiError } from '@/lib/api/http'

export interface TenantContextValue {
  slug: string
  data: Bootstrap
  api: PublicApi
  tz: string
  locale: string
  currency: string
  service: (id: string | null | undefined) => ServiceView | undefined
  mediaByKey: (key: string | null | undefined) => MediaView | undefined
  mediaFor: (kind: MediaView['kind'], serviceId?: string) => MediaView[]
}

const TenantContext = createContext<TenantContextValue | null>(null)

export const tenantQueryKey = (slug: string) => ['tenant', slug] as const

/** `fresh` (owner cabinet): always from the server, so a logo or icon just changed shows at once. */
export function useTenantBootstrap(slug: string, fresh = false) {
  return useQuery({
    queryKey: tenantQueryKey(slug),
    queryFn: () => publicApi(slug).bootstrap({ fresh }),
    staleTime: 60_000,
    gcTime: 24 * 3600_000,
    retry: (count, e) => !(e instanceof ApiError && e.status === 404) && count < 2,
  })
}

export function TenantProvider({ slug, data, children }: { slug: string; data: Bootstrap; children: ReactNode }) {
  const value = useMemo<TenantContextValue>(() => {
    const services = new Map(data.services.map((s) => [s.id, s]))
    const byKey = new Map(data.media.filter((m) => m.key).map((m) => [m.key!, m]))
    return {
      slug,
      data,
      api: publicApi(slug),
      tz: data.tenant.timezone,
      locale: data.tenant.locale,
      currency: data.tenant.currency,
      service: (id) => (id ? services.get(id) : undefined),
      mediaByKey: (key) => (key ? byKey.get(key) : undefined),
      mediaFor: (kind, serviceId) =>
        data.media.filter((m) => m.kind === kind && (serviceId === undefined || m.service_id === serviceId)).sort((a, b) => a.sort_order - b.sort_order),
    }
  }, [slug, data])
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant outside TenantProvider')
  return ctx
}
