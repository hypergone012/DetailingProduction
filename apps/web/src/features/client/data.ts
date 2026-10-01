import type { BookingSummary, ServiceView } from '@dp/core/api/contracts'
import type { BodyType } from '@dp/core/tenant/constants'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/http'
import { device } from '@/lib/device'
import { useTenant } from '@/tenant/TenantProvider'

export const keys = {
  profile: (slug: string) => ['client', slug, 'profile'] as const,
  booking: (slug: string, id: string) => ['client', slug, 'booking', id] as const,
  availability: (slug: string, params: unknown) => ['client', slug, 'availability', params] as const,
  push: (slug: string) => ['client', slug, 'push'] as const,
}

/** The device's profile (garage + history). Absent until the first booking or saved vehicle. */
export function useProfile() {
  const { slug, api } = useTenant()
  const hasKey = Boolean(device.clientKey(slug))
  const q = useQuery({
    queryKey: keys.profile(slug),
    queryFn: async () => {
      try {
        return await api.profile()
      } catch (e) {
        // The key was revoked elsewhere: forget it locally, the user starts fresh.
        if (e instanceof ApiError && e.code === 'PROFILE_NOT_FOUND') {
          device.forget(slug)
          return null
        }
        throw e
      }
    },
    enabled: hasKey,
    staleTime: 15_000,
  })
  return { ...q, hasProfile: hasKey && q.data !== null, profile: q.data ?? null }
}

export function useBooking(id: string | undefined, token?: string | null) {
  const { slug, api } = useTenant()
  return useQuery({
    queryKey: keys.booking(slug, id ?? ''),
    queryFn: () => api.booking(id!, token),
    enabled: Boolean(id),
    staleTime: 10_000,
  })
}

export function useInvalidateClient() {
  const qc = useQueryClient()
  const { slug } = useTenant()
  return () => qc.invalidateQueries({ queryKey: ['client', slug] })
}

export function useSaveVehicle() {
  const { api } = useTenant()
  const invalidate = useInvalidateClient()
  return useMutation({
    mutationFn: async (v: Parameters<typeof api.saveVehicle>[0]) => {
      await api.ensureProfile(crypto.randomUUID())
      return api.saveVehicle(v)
    },
    onSuccess: invalidate,
  })
}

/** Price and duration of a service for a body type (server re-computes on booking). */
export function priceFor(service: ServiceView, bodyType: BodyType | null | undefined) {
  const v = bodyType ? service.variants.find((x) => x.body_type === bodyType) : undefined
  return { price_cents: v?.price_cents ?? service.price_cents, duration_min: v?.duration_min ?? service.duration_min }
}

export function minPrice(service: ServiceView): number {
  return Math.min(service.price_cents, ...service.variants.map((v) => v.price_cents))
}

export function hasPriceRange(service: ServiceView): boolean {
  return service.variants.some((v) => v.price_cents !== service.price_cents)
}

export function isUpcoming(b: Pick<BookingSummary, 'status' | 'starts_at'>): boolean {
  return (b.status === 'pending' || b.status === 'confirmed' || b.status === 'in_progress') && new Date(b.starts_at).getTime() > Date.now() - 6 * 3600_000
}
