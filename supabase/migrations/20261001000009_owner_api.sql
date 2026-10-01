-- Owner (studio staff) API. Every function is SECURITY DEFINER, starts with
-- private.require_role(tenant, min_role) and resolves child ids inside that tenant.
-- Reads that need no aggregation go straight to the tables through RLS.

create or replace function private.booking_tenant(p_booking uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select tenant_id from public.bookings where id = p_booking
$$;

create or replace function public.owner_availability(
  p_tenant uuid, p_service_id uuid, p_body_type text, p_addon_ids uuid[], p_from_day date, p_days int,
  p_ignore_booking uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan private.service_plan;
begin
  perform private.require_role(p_tenant, 'staff');
  v_plan := private.plan_service(p_tenant, p_service_id, p_body_type, p_addon_ids, false);
  return jsonb_build_object(
    'price_cents', v_plan.price_cents, 'work_minutes', v_plan.work_minutes, 'items', v_plan.items,
    'slots', coalesce((select jsonb_agg(jsonb_build_object('starts_at', a.starts_at, 'ends_at', a.ends_at,
                                                            'local_day', a.local_day, 'local_time', a.local_time,
                                                            'free_resources', a.free_resources) order by a.starts_at)
                       from private.availability(p_tenant, v_plan, p_from_day, p_days, 'owner', p_ignore_booking) a), '[]'));
end;
$$;

-- payload: {customer: {id} | {name, phone, email}, vehicle: {id} | {make, model, body_type, ...} | null,
--           service_id, addon_ids[], starts_at, resource_id?, allow_outside_hours?, status?, note?, internal_note?}
create or replace function public.owner_create_booking(p_tenant uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_customer uuid;
  v_vehicle uuid;
  v_body text;
  v_plan private.service_plan;
  v_addons uuid[];
  v_booking uuid;
  v_c jsonb := p_payload -> 'customer';
  v_v jsonb := p_payload -> 'vehicle';
  v_resource uuid := (p_payload ->> 'resource_id')::uuid;
begin
  perform private.require_role(p_tenant, 'manager');
  select * into t from public.tenants where id = p_tenant;

  if v_c ? 'id' then
    select id into v_customer from public.customers where tenant_id = p_tenant and id = (v_c ->> 'id')::uuid;
    if v_customer is null then
      perform private.fail('CUSTOMER_NOT_FOUND', 'Клиент не найден');
    end if;
  else
    v_customer := private.upsert_customer(p_tenant, v_c ->> 'name', v_c ->> 'phone', v_c ->> 'email', t.status = 'demo');
  end if;

  if v_v is not null and jsonb_typeof(v_v) = 'object' then
    if v_v ? 'id' then
      select id, body_type into v_vehicle, v_body from public.customer_vehicles
      where tenant_id = p_tenant and id = (v_v ->> 'id')::uuid and customer_id = v_customer;
      if v_vehicle is null then
        perform private.fail('VEHICLE_NOT_FOUND', 'Автомобиль не найден у этого клиента');
      end if;
    else
      v_vehicle := private.insert_vehicle(p_tenant, v_customer, null, v_v, t.status = 'demo');
      v_body := v_v ->> 'body_type';
    end if;
  end if;

  if v_resource is not null and not exists (
      select 1 from public.resources r join public.services s on s.tenant_id = r.tenant_id
      where r.tenant_id = p_tenant and r.id = v_resource and r.active
        and s.id = (p_payload ->> 'service_id')::uuid and r.type = any (s.resource_types)) then
    perform private.fail('RESOURCE_NOT_SUITABLE', 'Этот ресурс не подходит для услуги');
  end if;

  select coalesce(array_agg(x::uuid), '{}') into v_addons
  from jsonb_array_elements_text(coalesce(p_payload -> 'addon_ids', '[]')) x;
  v_plan := private.plan_service(p_tenant, (p_payload ->> 'service_id')::uuid, v_body, v_addons, false);
  v_booking := private.place_booking(p_tenant, v_plan, (p_payload ->> 'starts_at')::timestamptz, 'owner',
    coalesce((p_payload ->> 'allow_outside_hours')::boolean, false), v_customer, v_vehicle, null,
    p_payload ->> 'note', p_payload ->> 'internal_note', v_resource, p_payload ->> 'status', auth.uid(),
    t.status = 'demo');
  return private.booking_json(v_booking, false);
end;
$$;

create or replace function public.owner_reschedule_booking(
  p_booking uuid, p_starts_at timestamptz, p_resource_id uuid default null, p_allow_outside_hours boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.booking_tenant(p_booking);
begin
  perform private.require_role(v_tenant, 'manager');
  if p_resource_id is not null and not exists (
      select 1 from public.bookings b
      join public.services s on s.tenant_id = b.tenant_id and s.id = b.service_id
      join public.resources r on r.tenant_id = b.tenant_id and r.id = p_resource_id
      where b.id = p_booking and r.active and r.type = any (s.resource_types)) then
    perform private.fail('RESOURCE_NOT_SUITABLE', 'Этот ресурс не подходит для услуги');
  end if;
  perform private.move_booking(p_booking, p_starts_at, 'owner', p_resource_id, coalesce(p_allow_outside_hours, false), auth.uid());
  return private.booking_json(p_booking, false);
end;
$$;

create or replace function public.owner_cancel_booking(p_booking uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role(private.booking_tenant(p_booking), 'manager');
  perform private.cancel_booking(p_booking, 'owner', p_reason, auth.uid());
  return private.booking_json(p_booking, false);
end;
$$;

create or replace function public.owner_set_booking_status(p_booking uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role(private.booking_tenant(p_booking), 'staff');
  perform private.transition_booking(p_booking, p_status, auth.uid());
  return private.booking_json(p_booking, false);
end;
$$;

-- patch: {internal_note?, client_note?, price_cents?, price_reason?}
-- A price change adds an 'adjustment' line so the original snapshot stays readable.
create or replace function public.owner_update_booking(p_booking uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  v_new bigint;
begin
  perform private.require_role(private.booking_tenant(p_booking), 'manager');
  select * into b from public.bookings where id = p_booking for update;
  if p_patch ? 'internal_note' or p_patch ? 'client_note' then
    update public.bookings
       set internal_note = coalesce(p_patch ->> 'internal_note', internal_note),
           client_note = coalesce(p_patch ->> 'client_note', client_note)
     where id = b.id;
    insert into public.booking_events (tenant_id, booking_id, event, data, actor, actor_user)
    values (b.tenant_id, b.id, 'note_changed', '{}', 'owner', auth.uid());
  end if;
  if p_patch ? 'price_cents' then
    v_new := (p_patch ->> 'price_cents')::bigint;
    if v_new < 0 then
      perform private.fail('INVALID_PRICE', 'Цена не может быть отрицательной');
    end if;
    if b.status in ('cancelled', 'no_show') then
      perform private.fail('INVALID_STATUS', 'Нельзя менять цену отменённой записи');
    end if;
    if v_new <> b.price_cents then
      insert into public.booking_items (tenant_id, booking_id, kind, name, price_cents, sort_order)
      values (b.tenant_id, b.id, 'adjustment', coalesce(nullif(btrim(p_patch ->> 'price_reason'), ''), 'Корректировка цены'),
              v_new - b.price_cents, 1000);
      update public.bookings set price_cents = v_new, version = version + 1 where id = b.id;
      insert into public.booking_events (tenant_id, booking_id, event, data, actor, actor_user)
      values (b.tenant_id, b.id, 'price_changed', jsonb_build_object('from', b.price_cents, 'to', v_new,
              'reason', p_patch ->> 'price_reason'), 'owner', auth.uid());
    end if;
  end if;
  return private.booking_json(p_booking, false);
end;
$$;

create or replace function public.owner_create_block(
  p_tenant uuid, p_resource_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_reason text, p_title text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_role(p_tenant, 'manager');
  v_id := private.place_block(p_tenant, p_resource_id, p_starts_at, p_ends_at, p_reason, p_title, p_note, auth.uid());
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.owner_release_block(p_occupancy uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.resource_occupancies where id = p_occupancy and kind = 'block';
  perform private.require_role(v_tenant, 'manager');
  update public.resource_occupancies set released_at = now(), release_reason = 'removed'
   where id = p_occupancy and kind = 'block' and released_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.owner_issue_share_token(p_booking uuid, p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.booking_tenant(p_booking);
begin
  perform private.require_role(v_tenant, 'staff');
  insert into public.booking_access_tokens (tenant_id, booking_id, token_hash, purpose)
  values (v_tenant, p_booking, p_token_hash, 'owner_share')
  on conflict (token_hash) do nothing;
  return jsonb_build_object('ok', true, 'slug', (select slug from public.tenants where id = v_tenant));
end;
$$;

-- payment: {booking_id?, customer_id?, kind, method, amount_cents, paid_at?, note?, idempotency_key?}
create or replace function public.owner_record_payment(p_tenant uuid, p_payment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_booking uuid := (p_payment ->> 'booking_id')::uuid;
  v_customer uuid := (p_payment ->> 'customer_id')::uuid;
  v_id uuid;
  v_key text := nullif(p_payment ->> 'idempotency_key', '');
begin
  perform private.require_role(p_tenant, 'manager');
  select * into t from public.tenants where id = p_tenant;
  if v_key is not null then
    select id into v_id from public.payments where tenant_id = p_tenant and idempotency_key = v_key;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'replayed', true);
    end if;
  end if;
  if v_booking is not null then
    select customer_id into v_customer from public.bookings where tenant_id = p_tenant and id = v_booking;
    if v_customer is null then
      perform private.fail('BOOKING_NOT_FOUND', 'Запись не найдена');
    end if;
  elsif v_customer is not null and not exists (select 1 from public.customers where tenant_id = p_tenant and id = v_customer) then
    perform private.fail('CUSTOMER_NOT_FOUND', 'Клиент не найден');
  end if;
  insert into public.payments (tenant_id, booking_id, customer_id, kind, method, amount_cents, currency, paid_at, note,
                               idempotency_key, recorded_by, is_demo)
  values (p_tenant, v_booking, v_customer, coalesce(p_payment ->> 'kind', 'payment'), p_payment ->> 'method',
          (p_payment ->> 'amount_cents')::bigint, t.currency, coalesce((p_payment ->> 'paid_at')::timestamptz, now()),
          coalesce(p_payment ->> 'note', ''), v_key, auth.uid(), t.status = 'demo')
  on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.payments where tenant_id = p_tenant and idempotency_key = v_key;
    return jsonb_build_object('id', v_id, 'replayed', true);
  end if;
  return jsonb_build_object('id', v_id, 'replayed', false);
end;
$$;

-- customer: {id?, name, phone?, email?, owner_notes?}
create or replace function public.owner_save_customer(p_tenant uuid, p_customer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_role(p_tenant, 'manager');
  if p_customer ? 'id' then
    update public.customers
       set name = coalesce(nullif(btrim(p_customer ->> 'name'), ''), name),
           phone_e164 = case when p_customer ? 'phone' then nullif(p_customer ->> 'phone', '') else phone_e164 end,
           email = case when p_customer ? 'email' then nullif(btrim(coalesce(p_customer ->> 'email', '')), '') else email end,
           owner_notes = coalesce(p_customer ->> 'owner_notes', owner_notes)
     where tenant_id = p_tenant and id = (p_customer ->> 'id')::uuid
    returning id into v_id;
    if v_id is null then
      perform private.fail('CUSTOMER_NOT_FOUND', 'Клиент не найден');
    end if;
  else
    insert into public.customers (tenant_id, name, phone_e164, email, owner_notes)
    values (p_tenant, btrim(p_customer ->> 'name'), nullif(p_customer ->> 'phone', ''),
            nullif(btrim(coalesce(p_customer ->> 'email', '')), ''), coalesce(p_customer ->> 'owner_notes', ''))
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
exception when unique_violation then
  perform private.fail('PHONE_TAKEN', 'Клиент с таким телефоном уже есть');
  return null;
end;
$$;

-- vehicle: {id?, customer_id, make, model, body_type, ...}
create or replace function public.owner_save_vehicle(p_tenant uuid, p_vehicle jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_role(p_tenant, 'manager');
  if p_vehicle ? 'id' then
    update public.customer_vehicles
       set nickname = nullif(btrim(coalesce(p_vehicle ->> 'nickname', '')), ''),
           make = btrim(p_vehicle ->> 'make'), model = btrim(p_vehicle ->> 'model'),
           generation = nullif(btrim(coalesce(p_vehicle ->> 'generation', '')), ''),
           year = (p_vehicle ->> 'year')::int, body_type = p_vehicle ->> 'body_type',
           color = nullif(btrim(coalesce(p_vehicle ->> 'color', '')), ''),
           plate = nullif(upper(btrim(coalesce(p_vehicle ->> 'plate', ''))), ''),
           owner_notes = coalesce(p_vehicle ->> 'owner_notes', owner_notes)
     where tenant_id = p_tenant and id = (p_vehicle ->> 'id')::uuid
    returning id into v_id;
    if v_id is null then
      perform private.fail('VEHICLE_NOT_FOUND', 'Автомобиль не найден');
    end if;
  else
    if not exists (select 1 from public.customers where tenant_id = p_tenant and id = (p_vehicle ->> 'customer_id')::uuid) then
      perform private.fail('CUSTOMER_NOT_FOUND', 'Клиент не найден');
    end if;
    v_id := private.insert_vehicle(p_tenant, (p_vehicle ->> 'customer_id')::uuid, null, p_vehicle, false);
    update public.customer_vehicles set owner_notes = coalesce(p_vehicle ->> 'owner_notes', '') where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

-- service: {id?, key, name, category, summary, description, duration_min, buffer_before_min,
--   buffer_after_min, price_cents, resource_types[], multi_day, requires_confirmation,
--   allowed_body_types[]|null, benefits[], prep_notes[], restrictions[], recommended_keys[],
--   repeat_interval_days, active, bookable_online, sort_order,
--   variants?: [{body_type, price_cents, duration_min}], addons?: [{id?, key, name, description, price_cents, duration_min, active, sort_order}]}
-- Changing price/duration affects only bookings created afterwards: bookings keep their snapshot.
create or replace function public.owner_save_service(p_tenant uuid, p_service jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  a jsonb;
begin
  perform private.require_role(p_tenant, 'manager');
  if p_service ? 'id' then
    update public.services set
      name = coalesce(p_service ->> 'name', name),
      category = coalesce(p_service ->> 'category', category),
      summary = coalesce(p_service ->> 'summary', summary),
      description = coalesce(p_service ->> 'description', description),
      duration_min = coalesce((p_service ->> 'duration_min')::int, duration_min),
      buffer_before_min = coalesce((p_service ->> 'buffer_before_min')::int, buffer_before_min),
      buffer_after_min = coalesce((p_service ->> 'buffer_after_min')::int, buffer_after_min),
      price_cents = coalesce((p_service ->> 'price_cents')::bigint, price_cents),
      resource_types = coalesce((select array_agg(x) from jsonb_array_elements_text(p_service -> 'resource_types') x), resource_types),
      multi_day = coalesce((p_service ->> 'multi_day')::boolean, multi_day),
      requires_confirmation = coalesce((p_service ->> 'requires_confirmation')::boolean, requires_confirmation),
      allowed_body_types = case when p_service ? 'allowed_body_types'
        then (select array_agg(x) from jsonb_array_elements_text(nullif(p_service -> 'allowed_body_types', 'null'::jsonb)) x)
        else allowed_body_types end,
      benefits = coalesce((select array_agg(x) from jsonb_array_elements_text(p_service -> 'benefits') x), benefits),
      prep_notes = coalesce((select array_agg(x) from jsonb_array_elements_text(p_service -> 'prep_notes') x), prep_notes),
      restrictions = coalesce((select array_agg(x) from jsonb_array_elements_text(p_service -> 'restrictions') x), restrictions),
      recommended_keys = coalesce((select array_agg(x) from jsonb_array_elements_text(p_service -> 'recommended_keys') x), recommended_keys),
      repeat_interval_days = case when p_service ? 'repeat_interval_days' then (p_service ->> 'repeat_interval_days')::int else repeat_interval_days end,
      active = coalesce((p_service ->> 'active')::boolean, active),
      bookable_online = coalesce((p_service ->> 'bookable_online')::boolean, bookable_online),
      sort_order = coalesce((p_service ->> 'sort_order')::int, sort_order),
      config_sig = null
    where tenant_id = p_tenant and id = (p_service ->> 'id')::uuid
    returning id into v_id;
    if v_id is null then
      perform private.fail('SERVICE_NOT_FOUND', 'Услуга не найдена');
    end if;
  else
    insert into public.services (tenant_id, key, name, category, summary, description, duration_min, buffer_before_min,
      buffer_after_min, price_cents, resource_types, multi_day, requires_confirmation, allowed_body_types, benefits,
      prep_notes, restrictions, recommended_keys, repeat_interval_days, active, bookable_online, sort_order)
    values (p_tenant, p_service ->> 'key', p_service ->> 'name', coalesce(p_service ->> 'category', 'other'),
      coalesce(p_service ->> 'summary', ''), coalesce(p_service ->> 'description', ''),
      (p_service ->> 'duration_min')::int, coalesce((p_service ->> 'buffer_before_min')::int, 0),
      coalesce((p_service ->> 'buffer_after_min')::int, 0), (p_service ->> 'price_cents')::bigint,
      (select array_agg(x) from jsonb_array_elements_text(p_service -> 'resource_types') x),
      coalesce((p_service ->> 'multi_day')::boolean, false), coalesce((p_service ->> 'requires_confirmation')::boolean, false),
      (select array_agg(x) from jsonb_array_elements_text(nullif(p_service -> 'allowed_body_types', 'null'::jsonb)) x),
      coalesce((select array_agg(x) from jsonb_array_elements_text(p_service -> 'benefits') x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(p_service -> 'prep_notes') x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(p_service -> 'restrictions') x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(p_service -> 'recommended_keys') x), '{}'),
      (p_service ->> 'repeat_interval_days')::int, coalesce((p_service ->> 'active')::boolean, true),
      coalesce((p_service ->> 'bookable_online')::boolean, true), coalesce((p_service ->> 'sort_order')::int, 0))
    returning id into v_id;
  end if;

  if p_service ? 'variants' then
    delete from public.service_variants where service_id = v_id;
    insert into public.service_variants (tenant_id, service_id, body_type, price_cents, duration_min)
    select p_tenant, v_id, x ->> 'body_type', (x ->> 'price_cents')::bigint, (x ->> 'duration_min')::int
    from jsonb_array_elements(p_service -> 'variants') x;
  end if;
  if p_service ? 'addons' then
    for a in select * from jsonb_array_elements(p_service -> 'addons') loop
      if a ? 'id' then
        update public.service_addons set name = a ->> 'name', description = coalesce(a ->> 'description', ''),
          price_cents = (a ->> 'price_cents')::bigint, duration_min = coalesce((a ->> 'duration_min')::int, 0),
          active = coalesce((a ->> 'active')::boolean, true), sort_order = coalesce((a ->> 'sort_order')::int, 0),
          config_sig = null
        where tenant_id = p_tenant and service_id = v_id and id = (a ->> 'id')::uuid;
      else
        insert into public.service_addons (tenant_id, service_id, key, name, description, price_cents, duration_min, active, sort_order)
        values (p_tenant, v_id, a ->> 'key', a ->> 'name', coalesce(a ->> 'description', ''), (a ->> 'price_cents')::bigint,
                coalesce((a ->> 'duration_min')::int, 0), coalesce((a ->> 'active')::boolean, true), coalesce((a ->> 'sort_order')::int, 0));
      end if;
    end loop;
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.owner_save_resource(p_tenant uuid, p_resource jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_role(p_tenant, 'owner');
  if p_resource ? 'id' then
    update public.resources set name = coalesce(p_resource ->> 'name', name), type = coalesce(p_resource ->> 'type', type),
      active = coalesce((p_resource ->> 'active')::boolean, active), sort_order = coalesce((p_resource ->> 'sort_order')::int, sort_order),
      config_sig = null
    where tenant_id = p_tenant and id = (p_resource ->> 'id')::uuid
    returning id into v_id;
    if v_id is null then
      perform private.fail('RESOURCE_NOT_FOUND', 'Ресурс не найден');
    end if;
  else
    insert into public.resources (tenant_id, key, name, type, sort_order)
    values (p_tenant, p_resource ->> 'key', p_resource ->> 'name', p_resource ->> 'type', coalesce((p_resource ->> 'sort_order')::int, 0))
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

-- hours: [{weekday, opens, closes}] replaces the weekly schedule.
create or replace function public.owner_set_hours(p_tenant uuid, p_hours jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role(p_tenant, 'owner');
  perform private.replace_hours(p_tenant, p_hours);
  update public.tenant_settings set hours_config_sig = null where tenant_id = p_tenant;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function private.replace_hours(p_tenant uuid, p_hours jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.business_hours where tenant_id = p_tenant;
  insert into public.business_hours (tenant_id, weekday, opens, closes)
  select p_tenant, (x ->> 'weekday')::smallint, (x ->> 'opens')::time, (x ->> 'closes')::time
  from jsonb_array_elements(coalesce(p_hours, '[]')) x;
  -- Windows of one weekday must not overlap.
  if exists (
    select 1 from public.business_hours a join public.business_hours b
      on a.tenant_id = b.tenant_id and a.weekday = b.weekday and a.id <> b.id
    where a.tenant_id = p_tenant
      and tsrange('2000-01-03'::date + a.weekday - 1 + a.opens,
                  '2000-01-03'::date + a.weekday - 1 + case when a.closes > a.opens then 0 else 1 end + a.closes)
       && tsrange('2000-01-03'::date + b.weekday - 1 + b.opens,
                  '2000-01-03'::date + b.weekday - 1 + case when b.closes > b.opens then 0 else 1 end + b.closes)) then
    perform private.fail('HOURS_OVERLAP', 'Интервалы рабочего времени пересекаются');
  end if;
end;
$$;

create or replace function public.owner_save_exception(p_tenant uuid, p_exception jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_role(p_tenant, 'manager');
  insert into public.business_exceptions (tenant_id, day, closed, opens, closes, note)
  values (p_tenant, (p_exception ->> 'day')::date, (p_exception ->> 'closed')::boolean,
          (p_exception ->> 'opens')::time, (p_exception ->> 'closes')::time, coalesce(p_exception ->> 'note', ''))
  on conflict (tenant_id, day) do update
    set closed = excluded.closed, opens = excluded.opens, closes = excluded.closes, note = excluded.note, config_sig = null
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.owner_delete_exception(p_exception uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.business_exceptions where id = p_exception;
  perform private.require_role(v_tenant, 'manager');
  delete from public.business_exceptions where id = p_exception;
  return jsonb_build_object('ok', true);
end;
$$;

-- patch keys: tagline, description, address, map_url, phone, email, website, socials, branding,
-- seo, features, slot_step_min, min_notice_min, horizon_days, cancel_cutoff_hours,
-- requires_confirmation, max_active_bookings_per_phone, reminder_hours_before,
-- notify_owner_push, notify_client_push
create or replace function public.owner_update_settings(p_tenant uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role(p_tenant, 'owner');
  update public.tenant_settings s set
    tagline = coalesce(p_patch ->> 'tagline', s.tagline),
    description = coalesce(p_patch ->> 'description', s.description),
    address = coalesce(p_patch ->> 'address', s.address),
    map_url = case when p_patch ? 'map_url' then nullif(p_patch ->> 'map_url', '') else s.map_url end,
    phone = case when p_patch ? 'phone' then nullif(p_patch ->> 'phone', '') else s.phone end,
    email = case when p_patch ? 'email' then nullif(p_patch ->> 'email', '') else s.email end,
    website = case when p_patch ? 'website' then nullif(p_patch ->> 'website', '') else s.website end,
    socials = coalesce(p_patch -> 'socials', s.socials),
    branding = case when p_patch ? 'branding' then s.branding || (p_patch -> 'branding') else s.branding end,
    seo = case when p_patch ? 'seo' then s.seo || (p_patch -> 'seo') else s.seo end,
    features = case when p_patch ? 'features' then s.features || (p_patch -> 'features') else s.features end,
    slot_step_min = coalesce((p_patch ->> 'slot_step_min')::int, s.slot_step_min),
    min_notice_min = coalesce((p_patch ->> 'min_notice_min')::int, s.min_notice_min),
    horizon_days = coalesce((p_patch ->> 'horizon_days')::int, s.horizon_days),
    cancel_cutoff_hours = coalesce((p_patch ->> 'cancel_cutoff_hours')::int, s.cancel_cutoff_hours),
    requires_confirmation = coalesce((p_patch ->> 'requires_confirmation')::boolean, s.requires_confirmation),
    max_active_bookings_per_phone = coalesce((p_patch ->> 'max_active_bookings_per_phone')::int, s.max_active_bookings_per_phone),
    reminder_hours_before = coalesce((p_patch ->> 'reminder_hours_before')::int, s.reminder_hours_before),
    notify_owner_push = coalesce((p_patch ->> 'notify_owner_push')::boolean, s.notify_owner_push),
    notify_client_push = coalesce((p_patch ->> 'notify_client_push')::boolean, s.notify_client_push),
    config_sig = null
  where s.tenant_id = p_tenant;
  return jsonb_build_object('ok', true);
end;
$$;

-- patch: {name?, slug?, timezone?}
create or replace function public.owner_update_tenant(p_tenant uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  perform private.require_role(p_tenant, 'owner');
  update public.tenants set
    name = coalesce(nullif(btrim(p_patch ->> 'name'), ''), name),
    slug = coalesce(nullif(lower(btrim(p_patch ->> 'slug')), ''), slug),
    timezone = coalesce(nullif(p_patch ->> 'timezone', ''), timezone),
    config_sig = null
  where id = p_tenant
  returning * into t;
  return jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'timezone', t.timezone);
exception when unique_violation then
  perform private.fail('SLUG_TAKEN', 'Этот адрес уже занят другой студией');
  return null;
end;
$$;

-- What must be true before a studio can go live (real notifications, real customers).
create or replace function private.live_readiness(p_tenant uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with s as (select * from public.tenant_settings where tenant_id = p_tenant),
  checks as (
    select 'contacts' as key, 'Указаны телефон и адрес студии' as label,
           ((select phone from s) is not null and length((select address from s)) > 0) as ok
    union all
    select 'hours', 'Задано рабочее время', exists (select 1 from public.business_hours where tenant_id = p_tenant)
    union all
    select 'resources', 'Есть хотя бы один активный ресурс', exists (select 1 from public.resources where tenant_id = p_tenant and active)
    union all
    select 'services', 'Есть услуга, доступная для онлайн-записи и исполнимая ресурсами студии',
           exists (select 1 from public.services sv where sv.tenant_id = p_tenant and sv.active and sv.bookable_online
                   and exists (select 1 from public.resources r where r.tenant_id = p_tenant and r.active and r.type = any (sv.resource_types)))
    union all
    select 'real_media', 'Демонстрационные иллюстрации заменены реальными фото',
           coalesce(((select branding from s) ->> 'demoArtwork')::boolean, false) = false
    union all
    select 'owner', 'У студии есть владелец с доступом в кабинет',
           exists (select 1 from public.tenant_members where tenant_id = p_tenant and role = 'owner')
  )
  select jsonb_build_object('ready', bool_and(ok), 'checks', jsonb_agg(jsonb_build_object('key', key, 'label', label, 'ok', ok)))
  from checks
$$;

create or replace function public.owner_live_readiness(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role(p_tenant, 'staff');
  return private.live_readiness(p_tenant);
end;
$$;

-- demo <-> live. Going live requires every readiness check; demo records stay flagged and
-- never produce notifications.
create or replace function public.owner_set_status(p_tenant uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ready jsonb;
begin
  perform private.require_role(p_tenant, 'owner');
  if p_status not in ('demo', 'live') then
    perform private.fail('INVALID_STATUS', 'Допустимо только demo или live');
  end if;
  if p_status = 'live' then
    v_ready := private.live_readiness(p_tenant);
    if not (v_ready ->> 'ready')::boolean then
      perform private.fail('NOT_READY', 'Студия ещё не готова к работе: ' ||
        (select string_agg(c ->> 'label', '; ') from jsonb_array_elements(v_ready -> 'checks') c where not (c ->> 'ok')::boolean));
    end if;
  end if;
  update public.tenants set status = p_status, live_since = case when p_status = 'live' then coalesce(live_since, now()) else live_since end
   where id = p_tenant;
  return jsonb_build_object('status', p_status);
end;
$$;

-- media: {path, bucket, kind, width?, height?, alt?, caption?, service_id?, booking_id?, vehicle_id?, client_visible?, variants?}
create or replace function public.owner_register_media(p_tenant uuid, p_media jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_role(p_tenant, 'manager');
  insert into public.media (tenant_id, kind, bucket, path, variants, width, height, alt, caption, service_id, booking_id,
                            vehicle_id, client_visible, source, sort_order)
  values (p_tenant, p_media ->> 'kind', p_media ->> 'bucket', p_media ->> 'path', coalesce(p_media -> 'variants', '[]'),
          (p_media ->> 'width')::int, (p_media ->> 'height')::int, coalesce(p_media ->> 'alt', ''),
          coalesce(p_media ->> 'caption', ''), (p_media ->> 'service_id')::uuid, (p_media ->> 'booking_id')::uuid,
          (p_media ->> 'vehicle_id')::uuid, coalesce((p_media ->> 'client_visible')::boolean, true), 'owner',
          coalesce((p_media ->> 'sort_order')::int, 100))
  returning id into v_id;
  if p_media ->> 'kind' = 'vehicle' and (p_media ->> 'vehicle_id') is not null then
    update public.customer_vehicles set photo_media_id = v_id where tenant_id = p_tenant and id = (p_media ->> 'vehicle_id')::uuid;
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.owner_update_media(p_media uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.media where id = p_media;
  perform private.require_role(v_tenant, 'manager');
  update public.media set
    alt = coalesce(p_patch ->> 'alt', alt), caption = coalesce(p_patch ->> 'caption', caption),
    client_visible = coalesce((p_patch ->> 'client_visible')::boolean, client_visible),
    sort_order = coalesce((p_patch ->> 'sort_order')::int, sort_order),
    config_sig = null
  where id = p_media;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.owner_delete_media(p_media uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.media;
begin
  select * into m from public.media where id = p_media;
  perform private.require_role(m.tenant_id, 'manager');
  delete from public.media where id = p_media;
  -- The caller removes the stored object only when no other row still uses it.
  return jsonb_build_object('bucket', m.bucket, 'path', m.path,
    'delete_object', not exists (select 1 from public.media x where x.bucket = m.bucket and x.path = m.path));
end;
$$;

create or replace function public.owner_push_subscribe(p_tenant uuid, p_subscription jsonb, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role(p_tenant, 'staff');
  insert into public.push_subscriptions (tenant_id, audience, user_id, endpoint, p256dh, auth, user_agent)
  values (p_tenant, 'owner', auth.uid(), p_subscription ->> 'endpoint', p_subscription #>> '{keys,p256dh}',
          p_subscription #>> '{keys,auth}', left(p_user_agent, 300))
  on conflict (tenant_id, endpoint) do update
    set audience = 'owner', user_id = auth.uid(), client_profile_id = null, booking_id = null,
        p256dh = excluded.p256dh, auth = excluded.auth, disabled_at = null, disabled_reason = null;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.owner_push_unsubscribe(p_tenant uuid, p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role(p_tenant, 'staff');
  delete from public.push_subscriptions where tenant_id = p_tenant and endpoint = p_endpoint and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- Dashboard statistics for tenant-local days [p_from, p_to]. Three money figures are kept
-- strictly apart:
--   scheduled_value  - price of bookings planned in the period (future money, not revenue)
--   completed_value  - price of work actually completed in the period (earned, maybe unpaid)
--   received_cents   - payments minus refunds actually recorded in the period (cash in)
create or replace function public.owner_stats(p_tenant uuid, p_from date, p_to date)
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
  v_windows tstzrange[];
  v_money boolean;
  v_result jsonb;
begin
  perform private.require_role(p_tenant, 'staff');
  if p_to < p_from or p_to - p_from > 366 then
    perform private.fail('INVALID_RANGE', 'Некорректный период');
  end if;
  v_money := private.has_role(p_tenant, 'manager');
  select timezone into v_tz from public.tenants where id = p_tenant;
  v_from := p_from::timestamp at time zone v_tz;
  v_to := (p_to + 1)::timestamp at time zone v_tz;
  select coalesce(array_agg(tstzrange(greatest(lower(w), v_from), least(upper(w), v_to), '[)')), '{}')
    into v_windows
  from unnest(private.working_windows(p_tenant, p_from - 1, p_to + 1)) w
  where w && tstzrange(v_from, v_to, '[)');

  with b as (
    select * from public.bookings where tenant_id = p_tenant and starts_at >= v_from and starts_at < v_to
  ),
  pay as (
    select * from public.payments where tenant_id = p_tenant and paid_at >= v_from and paid_at < v_to
  ),
  res as (
    select r.id, r.name, r.type, r.sort_order from public.resources r where r.tenant_id = p_tenant and r.active
  ),
  occ as (
    select o.resource_id, o.kind,
           sum(extract(epoch from (upper(o.during * w) - lower(o.during * w)))) / 60 as minutes
    from public.resource_occupancies o
    cross join unnest(v_windows) w
    where o.tenant_id = p_tenant and o.released_at is null and o.during && w
    group by o.resource_id, o.kind
  ),
  window_minutes as (
    select coalesce(sum(extract(epoch from (upper(w) - lower(w)))) / 60, 0) as minutes from unnest(v_windows) w
  ),
  per_resource as (
    select r.id, r.name, r.type, r.sort_order,
           coalesce((select minutes from occ where occ.resource_id = r.id and occ.kind = 'booking'), 0) as booked,
           coalesce((select minutes from occ where occ.resource_id = r.id and occ.kind = 'block'), 0) as blocked,
           (select minutes from window_minutes) as available
    from res r
  ),
  firsts as (
    select customer_id, min(starts_at) as first_at from public.bookings
    where tenant_id = p_tenant and status not in ('cancelled')
    group by customer_id
  ),
  active_customers as (
    select distinct customer_id from b where status not in ('cancelled', 'no_show')
  ),
  days as (
    select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', v_tz),
    'money_visible', v_money,
    'currency', (select currency from public.tenants where id = p_tenant),
    'upcoming', jsonb_build_object(
      'count', (select count(*) from b where status in ('pending', 'confirmed') and starts_at >= now()),
      'value_cents', case when v_money then (select coalesce(sum(price_cents), 0) from b where status in ('pending', 'confirmed') and starts_at >= now()) end),
    'scheduled', jsonb_build_object(
      'count', (select count(*) from b where status not in ('cancelled', 'no_show')),
      'value_cents', case when v_money then (select coalesce(sum(price_cents), 0) from b where status not in ('cancelled', 'no_show')) end),
    'completed', jsonb_build_object(
      'count', (select count(*) from b where status = 'completed'),
      'value_cents', case when v_money then (select coalesce(sum(price_cents), 0) from b where status = 'completed') end),
    'cancelled', jsonb_build_object(
      'count', (select count(*) from b where status = 'cancelled'),
      'value_cents', case when v_money then (select coalesce(sum(price_cents), 0) from b where status = 'cancelled') end),
    'no_show', jsonb_build_object('count', (select count(*) from b where status = 'no_show')),
    'payments', case when v_money then jsonb_build_object(
      'received_cents', (select coalesce(sum(case kind when 'payment' then amount_cents else -amount_cents end), 0) from pay),
      'payments_count', (select count(*) from pay where kind = 'payment'),
      'refunds_cents', (select coalesce(sum(amount_cents), 0) from pay where kind = 'refund')) end,
    'average_ticket_cents', case when v_money then
      (select (sum(price_cents) / nullif(count(*), 0))::bigint from b where status = 'completed') end,
    'utilization', jsonb_build_object(
      'booked_minutes', (select coalesce(sum(booked), 0)::int from per_resource),
      'blocked_minutes', (select coalesce(sum(blocked), 0)::int from per_resource),
      'available_minutes', (select coalesce(sum(available), 0)::int from per_resource),
      'ratio', (select round((sum(booked) / nullif(sum(available - blocked), 0))::numeric, 4) from per_resource),
      'resources', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', type,
                                                'booked_minutes', booked::int, 'blocked_minutes', blocked::int,
                                                'available_minutes', available::int,
                                                'ratio', round((booked / nullif(available - blocked, 0))::numeric, 4))
                                              order by sort_order, name) from per_resource), '[]')),
    'clients', jsonb_build_object(
      'active', (select count(*) from active_customers),
      'new', (select count(*) from firsts where first_at >= v_from and first_at < v_to),
      'returning', (select count(*) from active_customers ac
                    where exists (select 1 from public.bookings pb where pb.tenant_id = p_tenant
                                    and pb.customer_id = ac.customer_id and pb.status = 'completed' and pb.starts_at < v_from))),
    'daily', (select jsonb_agg(jsonb_build_object(
                'day', d.day,
                'bookings', (select count(*) from b where status not in ('cancelled', 'no_show')
                             and (starts_at at time zone v_tz)::date = d.day),
                'completed_value_cents', case when v_money then (select coalesce(sum(price_cents), 0) from b
                             where status = 'completed' and (starts_at at time zone v_tz)::date = d.day) end,
                'received_cents', case when v_money then (select coalesce(sum(case kind when 'payment' then amount_cents else -amount_cents end), 0)
                             from pay where (paid_at at time zone v_tz)::date = d.day) end
              ) order by d.day) from days d)
  ) into v_result;
  return v_result;
end;
$$;

-- Customer list with aggregates. security_invoker: the caller's RLS applies to every table
-- read here (staff see total_paid as 0 because payments are manager-only).
create view public.customer_overview with (security_invoker = true) as
select c.id, c.tenant_id, c.name, c.phone_e164, c.email, c.owner_notes, c.is_demo, c.created_at,
       (select count(*) from public.customer_vehicles v where v.tenant_id = c.tenant_id and v.customer_id = c.id and v.archived_at is null) as vehicles_count,
       (select count(*) from public.bookings b where b.tenant_id = c.tenant_id and b.customer_id = c.id) as bookings_count,
       (select count(*) from public.bookings b where b.tenant_id = c.tenant_id and b.customer_id = c.id and b.status = 'completed') as completed_count,
       (select count(*) from public.bookings b where b.tenant_id = c.tenant_id and b.customer_id = c.id and b.status = 'cancelled') as cancelled_count,
       (select max(b.starts_at) from public.bookings b where b.tenant_id = c.tenant_id and b.customer_id = c.id and b.status = 'completed') as last_visit_at,
       (select min(b.starts_at) from public.bookings b where b.tenant_id = c.tenant_id and b.customer_id = c.id
          and b.status in ('pending', 'confirmed') and b.starts_at >= now()) as next_visit_at,
       (select coalesce(sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end), 0)
          from public.payments p where p.tenant_id = c.tenant_id and p.customer_id = c.id) as total_paid_cents
from public.customers c;
grant select on public.customer_overview to authenticated;
