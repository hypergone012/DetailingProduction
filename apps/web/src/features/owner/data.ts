import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import { env } from '@/lib/env'
import { rows, rpc, supabase } from './api/client'
import type {
  BookingRow,
  CalendarData,
  CustomerRow,
  ExceptionRow,
  HoursRow,
  MediaRow,
  OwnerBooking,
  PaymentRow,
  Readiness,
  ResourceRow,
  Role,
  ServiceRow,
  SettingsRow,
  Stats,
  TenantRow,
  VehicleRow,
} from './api/types'

export interface OwnerContextValue {
  tenantId: string
  slug: string
  role: Role
  userId: string
  email: string
  tz: string
  locale: string
  currency: string
  /** manager or owner: may change bookings and see money. */
  canManage: boolean
  isOwner: boolean
}

export const OwnerContext = createContext<OwnerContextValue | null>(null)

export function useOwner(): OwnerContextValue {
  const ctx = useContext(OwnerContext)
  if (!ctx) throw new Error('useOwner outside the cabinet')
  return ctx
}

export const ownerKeys = {
  all: (tenantId: string) => ['owner', tenantId] as const,
  membership: (tenantId: string, userId: string) => ['owner', tenantId, 'membership', userId] as const,
  calendar: (tenantId: string, from: string, days: number) => ['owner', tenantId, 'calendar', from, days] as const,
  booking: (tenantId: string, id: string) => ['owner', tenantId, 'booking', id] as const,
  stats: (tenantId: string, from: string, to: string) => ['owner', tenantId, 'stats', from, to] as const,
  customers: (tenantId: string, q: string) => ['owner', tenantId, 'customers', q] as const,
  customer: (tenantId: string, id: string) => ['owner', tenantId, 'customer', id] as const,
  catalog: (tenantId: string) => ['owner', tenantId, 'catalog'] as const,
  schedule: (tenantId: string) => ['owner', tenantId, 'schedule'] as const,
  settings: (tenantId: string) => ['owner', tenantId, 'settings'] as const,
  media: (tenantId: string) => ['owner', tenantId, 'media'] as const,
  readiness: (tenantId: string) => ['owner', tenantId, 'readiness'] as const,
  availability: (tenantId: string, key: string) => ['owner', tenantId, 'availability', key] as const,
}

export function useMembership(tenantId: string, userId: string | undefined) {
  return useQuery({
    queryKey: ownerKeys.membership(tenantId, userId ?? ''),
    enabled: Boolean(userId),
    queryFn: async () => {
      const r = await rows<{ role: Role }>(supabase().from('tenant_members').select('role').eq('tenant_id', tenantId).eq('user_id', userId!))
      return r[0]?.role ?? null
    },
    staleTime: 5 * 60_000,
  })
}

export function useCalendar(from: string, days: number) {
  const { tenantId } = useOwner()
  return useQuery({
    queryKey: ownerKeys.calendar(tenantId, from, days),
    queryFn: () => rpc<CalendarData>('owner_calendar', { p_tenant: tenantId, p_from_day: from, p_days: days }),
    staleTime: 15_000,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useBooking(id: string | null) {
  const { tenantId } = useOwner()
  return useQuery({
    queryKey: ownerKeys.booking(tenantId, id ?? ''),
    enabled: Boolean(id),
    queryFn: () => rpc<OwnerBooking>('owner_booking', { p_booking: id }),
  })
}

export function useStats(from: string, to: string) {
  const { tenantId } = useOwner()
  return useQuery({
    queryKey: ownerKeys.stats(tenantId, from, to),
    queryFn: () => rpc<Stats>('owner_stats', { p_tenant: tenantId, p_from: from, p_to: to }),
    staleTime: 60_000,
  })
}

export function useCustomers(q: string, enabled = true) {
  const { tenantId } = useOwner()
  return useQuery({
    queryKey: ownerKeys.customers(tenantId, q),
    enabled,
    queryFn: () => {
      let query = supabase().from('customer_overview').select('*').eq('tenant_id', tenantId)
      const term = q.trim().replace(/[%,()*]/g, ' ').trim()
      if (term) {
        const digits = term.replace(/\D/g, '')
        query = query.or(digits.length >= 3 ? `name.ilike.*${term}*,phone_e164.ilike.*${digits}*` : `name.ilike.*${term}*`)
      }
      return rows<CustomerRow>(query.order('next_visit_at', { ascending: true, nullsFirst: false }).order('name').limit(200))
    },
    placeholderData: (prev) => prev,
  })
}

export interface CustomerDetail {
  customer: CustomerRow
  vehicles: VehicleRow[]
  bookings: BookingRow[]
  payments: PaymentRow[] | null
}

export function useCustomer(id: string) {
  const { tenantId, canManage } = useOwner()
  return useQuery({
    queryKey: ownerKeys.customer(tenantId, id),
    enabled: Boolean(id),
    queryFn: async (): Promise<CustomerDetail | null> => {
      const db = supabase()
      const [customer, vehicles, bookings, payments] = await Promise.all([
        rows<CustomerRow>(db.from('customer_overview').select('*').eq('tenant_id', tenantId).eq('id', id)),
        rows<VehicleRow>(db.from('customer_vehicles').select('*').eq('tenant_id', tenantId).eq('customer_id', id).is('archived_at', null).order('created_at')),
        rows<BookingRow>(
          db.from('bookings').select('id,code,status,starts_at,ends_at,service_name,price_cents,currency,vehicle_id,resource_id,is_demo')
            .eq('tenant_id', tenantId).eq('customer_id', id).order('starts_at', { ascending: false }).limit(200),
        ),
        canManage
          ? rows<PaymentRow>(db.from('payments').select('id,kind,method,amount_cents,paid_at,note').eq('tenant_id', tenantId).eq('customer_id', id).order('paid_at', { ascending: false }))
          : Promise.resolve(null),
      ])
      if (!customer[0]) return null
      return { customer: customer[0], vehicles, bookings, payments }
    },
  })
}

export interface Catalog {
  services: ServiceRow[]
  resources: ResourceRow[]
}

export function useCatalog() {
  const { tenantId } = useOwner()
  return useQuery({
    queryKey: ownerKeys.catalog(tenantId),
    queryFn: async (): Promise<Catalog> => {
      const db = supabase()
      const [services, resources] = await Promise.all([
        rows<ServiceRow>(db.from('services').select('*,service_variants(body_type,price_cents,duration_min),service_addons(id,key,name,description,price_cents,duration_min,active,sort_order)').eq('tenant_id', tenantId).order('sort_order').order('name')),
        rows<ResourceRow>(db.from('resources').select('id,key,name,type,active,sort_order').eq('tenant_id', tenantId).order('sort_order').order('name')),
      ])
      return { services, resources }
    },
    staleTime: 60_000,
  })
}

export function useSchedule() {
  const { tenantId } = useOwner()
  return useQuery({
    queryKey: ownerKeys.schedule(tenantId),
    queryFn: async () => {
      const db = supabase()
      const [hours, exceptions] = await Promise.all([
        rows<HoursRow>(db.from('business_hours').select('id,weekday,opens,closes').eq('tenant_id', tenantId).order('weekday').order('opens')),
        rows<ExceptionRow>(db.from('business_exceptions').select('id,day,closed,opens,closes,note').eq('tenant_id', tenantId).gte('day', new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)).order('day')),
      ])
      return { hours, exceptions }
    },
  })
}

export function useSettings() {
  const { tenantId } = useOwner()
  return useQuery({
    queryKey: ownerKeys.settings(tenantId),
    queryFn: async () => {
      const db = supabase()
      const [tenant, settings] = await Promise.all([
        rows<TenantRow>(db.from('tenants').select('id,slug,name,status,timezone,locale,currency,live_since').eq('id', tenantId)),
        rows<SettingsRow>(db.from('tenant_settings').select('*').eq('tenant_id', tenantId)),
      ])
      if (!tenant[0] || !settings[0]) throw new Error('settings not found')
      return { tenant: tenant[0], settings: settings[0] }
    },
  })
}

export function useMedia() {
  const { tenantId } = useOwner()
  return useQuery({
    queryKey: ownerKeys.media(tenantId),
    queryFn: () =>
      rows<MediaRow>(
        supabase().from('media').select('id,key,kind,bucket,path,variants,alt,caption,service_id,client_visible,sort_order,source')
          .eq('tenant_id', tenantId).eq('bucket', 'public-media').order('sort_order'),
      ),
  })
}

export function useReadiness() {
  const { tenantId } = useOwner()
  return useQuery({
    queryKey: ownerKeys.readiness(tenantId),
    queryFn: () => rpc<Readiness>('owner_live_readiness', { p_tenant: tenantId }),
  })
}

/** Public object URL (public-media bucket). */
export function publicMediaUrl(path: string): string {
  return `${env.supabaseUrl}/storage/v1/object/public/public-media/${path}`
}

/** Short-lived URLs for private photos; Storage RLS lets only this studio's staff sign them. */
export function useSignedUrls(paths: string[]) {
  const { tenantId } = useOwner()
  return useQuery({
    queryKey: ['owner', tenantId, 'signed', ...paths],
    enabled: paths.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase().storage.from('private-media').createSignedUrls(paths, 3600)
      if (error) throw error
      const out: Record<string, string> = {}
      for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
      return out
    },
    staleTime: 30 * 60_000,
  })
}

/** Every owner mutation refreshes the whole cabinet cache of this studio (it is small). */
export function useOwnerMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, extraKeys: readonly (readonly unknown[])[] = []) {
  const qc = useQueryClient()
  const { tenantId } = useOwner()
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ownerKeys.all(tenantId) }), ...extraKeys.map((k) => qc.invalidateQueries({ queryKey: k }))])
    },
  })
}
