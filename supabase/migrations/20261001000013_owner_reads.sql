-- Aggregated reads for the owner cabinet. Plain lists go through PostgREST under RLS; these
-- two need joins and tenant-local time arithmetic that belong next to the engine.

-- Calendar of tenant-local days [p_from_day, p_from_day + p_days): active resources (lanes),
-- working windows (to shade closed time) and every active occupancy (bookings and blocks).
create or replace function public.owner_calendar(p_tenant uuid, p_from_day date, p_days int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_range tstzrange;
begin
  perform private.require_role(p_tenant, 'staff');
  if p_days < 1 or p_days > 31 then
    perform private.fail('INVALID_RANGE', 'Некорректный период');
  end if;
  select timezone into v_tz from public.tenants where id = p_tenant;
  v_from := p_from_day::timestamp at time zone v_tz;
  v_to := (p_from_day + p_days)::timestamp at time zone v_tz;
  v_range := tstzrange(v_from, v_to, '[)');
  return jsonb_build_object(
    'timezone', v_tz,
    'from', v_from,
    'to', v_to,
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name, 'type', r.type) order by r.sort_order, r.name)
      from public.resources r where r.tenant_id = p_tenant and r.active), '[]'),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', greatest(lower(w), v_from), 'ends_at', least(upper(w), v_to)) order by lower(w))
      from unnest(private.working_windows(p_tenant, p_from_day - 1, p_from_day + p_days)) w
      where w && v_range), '[]'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'kind', o.kind,
        'resource_id', o.resource_id,
        'starts_at', lower(o.during),
        'ends_at', upper(o.during),
        'booking', case when o.kind = 'booking' then jsonb_build_object(
          'id', b.id, 'code', b.code, 'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
          'service_id', b.service_id, 'service_name', b.service_name, 'price_cents', b.price_cents,
          'currency', b.currency, 'multi_day', b.multi_day, 'source', b.source, 'is_demo', b.is_demo,
          'buffer_before_min', b.buffer_before_min, 'buffer_after_min', b.buffer_after_min,
          'customer_note', b.customer_note, 'has_internal_note', b.internal_note <> '',
          'customer', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone_e164),
          'vehicle', case when v.id is null then null else jsonb_build_object(
            'id', v.id, 'make', v.make, 'model', v.model, 'plate', v.plate, 'body_type', v.body_type, 'color', v.color) end
        ) end,
        'block', case when o.kind = 'block' then jsonb_build_object('reason', o.block_reason, 'title', o.title, 'note', o.note) end
      ) order by lower(o.during))
      from public.resource_occupancies o
      left join public.bookings b on b.tenant_id = o.tenant_id and b.id = o.booking_id
      left join public.customers c on c.tenant_id = b.tenant_id and c.id = b.customer_id
      left join public.customer_vehicles v on v.tenant_id = b.tenant_id and v.id = b.vehicle_id
      where o.tenant_id = p_tenant and o.released_at is null and o.during && v_range), '[]')
  );
end;
$$;

-- One booking for the cabinet: the booking view plus history, payments (managers only) and
-- before/after photos. Photo objects are private; the cabinet signs URLs itself (Storage RLS).
create or replace function public.owner_booking(p_booking uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.booking_tenant(p_booking);
  v_money boolean;
  v_out jsonb;
begin
  perform private.require_role(v_tenant, 'staff');
  v_money := private.has_role(v_tenant, 'manager');
  v_out := private.booking_json(p_booking, false) || jsonb_build_object(
    'customer_id', (select customer_id from public.bookings where id = p_booking),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('event', e.event, 'actor', e.actor, 'data', e.data, 'at', e.created_at) order by e.id)
      from public.booking_events e where e.tenant_id = v_tenant and e.booking_id = p_booking), '[]'),
    'media', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'bucket', m.bucket, 'path', m.path,
                                          'caption', m.caption, 'client_visible', m.client_visible, 'created_at', m.created_at)
                       order by m.created_at)
      from public.media m where m.tenant_id = v_tenant and m.booking_id = p_booking), '[]'),
    'money_visible', v_money,
    'payments', case when v_money then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'method', p.method, 'amount_cents', p.amount_cents,
                                          'paid_at', p.paid_at, 'note', p.note) order by p.paid_at)
      from public.payments p where p.tenant_id = v_tenant and p.booking_id = p_booking), '[]') end
  );
  if not v_money then
    v_out := v_out - 'paid_cents';
  end if;
  return v_out;
end;
$$;

revoke execute on function public.owner_calendar(uuid, date, int), public.owner_booking(uuid) from public, anon;
grant execute on function public.owner_calendar(uuid, date, int), public.owner_booking(uuid) to authenticated;
