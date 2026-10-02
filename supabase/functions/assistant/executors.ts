/**
 * Tool executors. Each runs inside a scope the server resolved BEFORE the model was called:
 *   client — the studio (slug) and, optionally, this device's profile key hash;
 *   owner  — the studio and the signed-in user's JWT (RLS + owner_* role checks apply).
 * Inputs were validated by parseToolCall; nothing here trusts a value from the model to
 * pick a tenant, price, resource or permission.
 */
import type { AvailabilityResponse, Bootstrap, ProfileView } from '../_vendor/core/api/contracts.ts'
import type { AssistantAction, ToolInput, ToolName } from '../_vendor/core/ai/tools.ts'
import { partRange } from '../_vendor/core/ai/dates.ts'
import { HttpError } from '../_shared/http.ts'
import { rpc, select } from '../_shared/postgrest.ts'
import { formatMoney, labelWhen, localMinutes } from './format.ts'

export type Scope =
  | { kind: 'client'; slug: string; data: Bootstrap; profileKeyHash: string | null }
  | { kind: 'owner'; slug: string; data: Bootstrap; userJwt: string; canManage: boolean }

export interface ToolOutcome {
  /** JSON-serializable result for the model (or the fallback composer). */
  result: unknown
  actions: AssistantAction[]
}

const ok = (result: unknown, actions: AssistantAction[] = []): ToolOutcome => ({ result, actions })

function services(scope: Scope) {
  const { data } = scope
  return data.services.map((s) => ({
    id: s.id,
    name: s.name,
    summary: s.summary,
    duration_min: s.multi_day ? null : s.duration_min,
    multi_day: s.multi_day,
    price: formatMoney(s.price_cents, data.tenant.currency),
    price_by_body_type: s.variants.map((v) => ({ body_type: v.body_type, price: formatMoney(v.price_cents, data.tenant.currency), duration_min: v.duration_min })),
    addons: s.addons.map((a) => ({ name: a.name, price: formatMoney(a.price_cents, data.tenant.currency) })),
    requires_confirmation: s.requires_confirmation,
    allowed_body_types: s.allowed_body_types,
  }))
}

async function availability(scope: Scope, input: ToolInput<'check_availability'>) {
  const days = input.days ?? 3
  const raw =
    scope.kind === 'owner'
      ? await rpc<AvailabilityResponse>(
          'owner_availability',
          { p_tenant: scope.data.tenant.id, p_service_id: input.service_id, p_body_type: input.body_type ?? null, p_addon_ids: [], p_from_day: input.date, p_days: days },
          { userJwt: scope.userJwt },
        )
      : await rpc<AvailabilityResponse>('api_public_availability', {
          p_slug: scope.slug,
          p_service_id: input.service_id,
          p_body_type: input.body_type ?? null,
          p_addon_ids: [],
          p_from_day: input.date,
          p_days: days,
          p_ignore_booking: null,
        })
  const tz = scope.data.tenant.timezone
  let slots = raw.slots
  if (input.part_of_day) {
    const [from, to] = partRange(input.part_of_day)
    slots = slots.filter((s) => {
      const m = localMinutes(s.starts_at, tz)
      return m >= from && m < to
    })
  }
  return { raw, slots }
}

export async function execute(scope: Scope, name: ToolName, input: Record<string, unknown>): Promise<ToolOutcome> {
  const { data } = scope
  const tz = data.tenant.timezone
  const currency = data.tenant.currency
  switch (name) {
    case 'list_services':
      return ok({ currency, services: services(scope) })

    case 'check_availability': {
      const i = input as ToolInput<'check_availability'>
      const { raw, slots } = await availability(scope, i)
      return ok({
        timezone: tz,
        price: formatMoney(raw.price_cents, currency),
        price_cents: raw.price_cents,
        work_minutes: raw.work_minutes,
        multi_day: raw.multi_day,
        slots: slots.slice(0, 40).map((s) => ({ starts_at: s.starts_at, local: `${s.local_day} ${s.local_time}`, label: labelWhen(s.starts_at, tz) })),
        more: Math.max(0, slots.length - 40),
      })
    }

    case 'studio_info': {
      const i = input as ToolInput<'studio_info'>
      if (i.topic === 'hours') return ok({ timezone: tz, weekly: data.hours, exceptions: data.exceptions.slice(0, 10) })
      if (i.topic === 'address') {
        return ok({ address: data.profile.address, map_url: data.profile.map_url }, data.profile.map_url ? [{ type: 'open_url', url: data.profile.map_url, label: 'Открыть карту' }] : [])
      }
      if (i.topic === 'contacts') {
        return ok(
          { phone: data.profile.phone, email: data.profile.email, website: data.profile.website, socials: data.profile.socials },
          data.profile.phone ? [{ type: 'call', phone: data.profile.phone, label: 'Позвонить' }] : [],
        )
      }
      return ok({
        min_notice_hours: Math.round(data.policy.min_notice_min / 60),
        booking_horizon_days: data.policy.horizon_days,
        free_cancel_or_reschedule_until_hours_before: data.policy.cancel_cutoff_hours,
        requires_confirmation: data.policy.requires_confirmation,
      })
    }

    case 'my_bookings': {
      if (scope.kind !== 'client') throw new HttpError('FORBIDDEN')
      if (!scope.profileKeyHash) return ok({ bookings: [], note: 'С этого устройства ещё не было записей' })
      const p = await rpc<ProfileView>('api_public_profile', { p_slug: scope.slug, p_profile_key_hash: scope.profileKeyHash }).catch((e: unknown) => {
        if (e instanceof HttpError && e.code === 'PROFILE_NOT_FOUND') return null
        throw e
      })
      const bookings = (p?.bookings ?? []).slice(0, 6).map((b) => ({ code: b.code, service: b.service_name, when: labelWhen(b.starts_at, tz), status: b.status, price: formatMoney(b.price_cents, b.currency || currency), can_modify: b.can_modify }))
      const actions: AssistantAction[] = (p?.bookings ?? []).filter((b) => b.can_modify).slice(0, 2).map((b) => ({ type: 'open_booking', booking_id: b.id, label: `Запись ${b.code}` }))
      return ok({ bookings }, actions)
    }

    case 'propose_booking': {
      if (scope.kind !== 'client') throw new HttpError('FORBIDDEN')
      const i = input as ToolInput<'propose_booking'>
      const service = data.services.find((s) => s.id === i.service_id)
      if (!service) throw new HttpError('SERVICE_NOT_FOUND', 'Такой услуги нет в студии')
      const day = new Date(i.starts_at)
      const localDay = labelWhen(i.starts_at, tz, 'day')
      const { raw } = await availability(scope, { service_id: i.service_id, date: localDay, days: 1, body_type: i.body_type ?? null })
      const slot = raw.slots.find((s) => new Date(s.starts_at).getTime() === day.getTime())
      if (!slot) throw new HttpError('SLOT_UNAVAILABLE', 'Это время недоступно: выберите один из свободных слотов check_availability')
      const label = `Записаться: ${service.name}, ${labelWhen(slot.starts_at, tz)} · ${formatMoney(raw.price_cents, currency)}`
      return ok(
        { shown_to_client: true, service: service.name, when: labelWhen(slot.starts_at, tz), price: formatMoney(raw.price_cents, currency), note: 'Клиент увидит кнопку и подтвердит запись сам' },
        [{ type: 'book', service_id: service.id, starts_at: slot.starts_at, body_type: i.body_type ?? null, label, price_cents: raw.price_cents }],
      )
    }

    case 'day_schedule': {
      if (scope.kind !== 'owner') throw new HttpError('FORBIDDEN')
      const i = input as ToolInput<'day_schedule'>
      const cal = await rpc<{
        resources: { id: string; name: string }[]
        windows: { starts_at: string; ends_at: string }[]
        items: { kind: string; resource_id: string; starts_at: string; ends_at: string; booking: { id: string; code: string; status: string; starts_at: string; ends_at: string; service_name: string; customer: { name: string }; vehicle: { make: string; model: string; plate: string | null } | null; customer_note: string } | null; block: { reason: string; title: string | null } | null }[]
      }>('owner_calendar', { p_tenant: data.tenant.id, p_from_day: i.date, p_days: 1 }, { userJwt: scope.userJwt })
      const lanes = new Map(cal.resources.map((r) => [r.id, r.name]))
      const items = cal.items.map((it) =>
        it.booking
          ? {
              booking_code: it.booking.code,
              time: `${labelWhen(it.booking.starts_at, tz, 'time')}–${labelWhen(it.booking.ends_at, tz, 'time')}`,
              resource: lanes.get(it.resource_id),
              status: it.booking.status,
              service: it.booking.service_name,
              customer: it.booking.customer.name,
              vehicle: it.booking.vehicle ? `${it.booking.vehicle.make} ${it.booking.vehicle.model}${it.booking.vehicle.plate ? ` ${it.booking.vehicle.plate}` : ''}` : null,
              client_comment: it.booking.customer_note || null,
            }
          : { block: it.block?.title ?? it.block?.reason, time: `${labelWhen(it.starts_at, tz, 'time')}–${labelWhen(it.ends_at, tz, 'time')}`, resource: lanes.get(it.resource_id) },
      )
      return ok(
        { date: i.date, open: cal.windows.length > 0, items },
        cal.items.filter((it) => it.booking).slice(0, 3).map((it) => ({ type: 'open_booking', booking_id: it.booking!.id, label: `${labelWhen(it.booking!.starts_at, tz, 'time')} ${it.booking!.customer.name}` })),
      )
    }

    case 'find_customers': {
      if (scope.kind !== 'owner') throw new HttpError('FORBIDDEN')
      const i = input as ToolInput<'find_customers'>
      const term = i.query.replace(/[%,()*]/g, ' ').trim()
      const digits = term.replace(/\D/g, '')
      const filter = digits.length >= 3 ? `or=(name.ilike.*${encodeURIComponent(term)}*,phone_e164.ilike.*${digits}*)` : `name=ilike.*${encodeURIComponent(term)}*`
      const rows = await select<{ id: string; name: string; phone_e164: string | null; completed_count: number; next_visit_at: string | null; last_visit_at: string | null; vehicles_count: number }>(
        `customer_overview?select=id,name,phone_e164,completed_count,next_visit_at,last_visit_at,vehicles_count&tenant_id=eq.${data.tenant.id}&${filter}&limit=10`,
        scope.userJwt,
      )
      return ok(
        { customers: rows.map((r) => ({ name: r.name, phone: r.phone_e164, visits: r.completed_count, next_visit: r.next_visit_at ? labelWhen(r.next_visit_at, tz) : null, last_visit: r.last_visit_at ? labelWhen(r.last_visit_at, tz, 'date') : null, vehicles: r.vehicles_count })) },
        rows.slice(0, 3).map((r) => ({ type: 'open_customer', customer_id: r.id, label: r.name })),
      )
    }

    case 'period_stats': {
      if (scope.kind !== 'owner') throw new HttpError('FORBIDDEN')
      const i = input as ToolInput<'period_stats'>
      const s = await rpc<Record<string, unknown> & { money_visible: boolean }>('owner_stats', { p_tenant: data.tenant.id, p_from: i.from, p_to: i.to }, { userJwt: scope.userJwt })
      // The daily series is long and not needed for a chat answer.
      const { daily: _daily, ...summary } = s
      return ok({ ...summary, note: 'scheduled/upcoming — будущие деньги; completed — выполненные работы; payments.received_cents — полученные оплаты. Суммы в копейках.' })
    }

    case 'booking_by_code': {
      if (scope.kind !== 'owner') throw new HttpError('FORBIDDEN')
      const i = input as ToolInput<'booking_by_code'>
      const rows = await select<{ id: string }>(`bookings?select=id&tenant_id=eq.${data.tenant.id}&code=eq.${i.code}`, scope.userJwt)
      if (!rows[0]) throw new HttpError('BOOKING_NOT_FOUND', 'Записи с таким номером нет')
      const b = await rpc<{ id: string; code: string; status: string; starts_at: string; ends_at: string; service: { name: string }; customer: { name: string; phone: string | null }; price_cents: number; paid_cents?: number; resource: { name: string } | null; internal_note: string }>(
        'owner_booking',
        { p_booking: rows[0].id },
        { userJwt: scope.userJwt },
      )
      return ok(
        {
          code: b.code,
          status: b.status,
          when: labelWhen(b.starts_at, tz),
          service: b.service.name,
          customer: b.customer.name,
          phone: b.customer.phone,
          resource: b.resource?.name ?? null,
          price: formatMoney(b.price_cents, currency),
          paid: b.paid_cents === undefined ? null : formatMoney(b.paid_cents, currency),
          studio_note: b.internal_note || null,
        },
        [{ type: 'open_booking', booking_id: b.id, label: `Открыть запись ${b.code}` }],
      )
    }
  }
}
