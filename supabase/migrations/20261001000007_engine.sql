-- Booking engine. All availability and placement rules live here, in one place, and run
-- inside the same transaction that writes the occupancy. The frontend never decides
-- whether a slot is free; it only displays what these functions return.
--
-- Time model
--   * business hours/exceptions are tenant-local wall-clock times, converted with
--     `(date + time) AT TIME ZONE tenant.timezone` (DST-correct);
--   * windows are merged when they touch, so a 24h studio is one continuous window;
--   * a regular service must finish inside the window it starts in;
--   * a multi_day service spreads its work minutes over consecutive windows and keeps the
--     resource occupied continuously until it finishes (the car stays in the bay overnight);
--   * the occupancy is [start - buffer_before, end + buffer_after).
--   Durations are added as exact seconds, never as calendar days.

create type private.service_plan as (
  service_id uuid,
  service_name text,
  body_type text,
  work_minutes int,
  buffer_before_min int,
  buffer_after_min int,
  price_cents bigint,
  multi_day boolean,
  resource_types text[],
  requires_confirmation boolean,
  items jsonb
);

-- Merged working windows for tenant-local days [p_from_day, p_to_day].
create or replace function private.working_windows(p_tenant uuid, p_from_day date, p_to_day date)
returns tstzrange[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text;
  v_out tstzrange[] := '{}';
  v_cur tstzrange;
  r record;
begin
  select timezone into v_tz from public.tenants where id = p_tenant;
  if v_tz is null then
    return v_out;
  end if;
  for r in
    with days as (
      select d::date as day from generate_series(p_from_day::timestamp, p_to_day::timestamp, interval '1 day') d
    ),
    raw as (
      select ((dd.day + h.opens) at time zone v_tz) as s,
             (((case when h.closes > h.opens then dd.day else dd.day + 1 end) + h.closes) at time zone v_tz) as e
      from days dd
      join public.business_hours h on h.tenant_id = p_tenant and h.weekday = extract(isodow from dd.day)
      where not exists (
        select 1 from public.business_exceptions x where x.tenant_id = p_tenant and x.day = dd.day)
      union all
      select ((x.day + x.opens) at time zone v_tz),
             (((case when x.closes > x.opens then x.day else x.day + 1 end) + x.closes) at time zone v_tz)
      from public.business_exceptions x
      where x.tenant_id = p_tenant and x.day between p_from_day and p_to_day and not x.closed
    )
    select s, e from raw where e > s order by s, e
  loop
    if v_cur is null then
      v_cur := tstzrange(r.s, r.e, '[)');
    elsif r.s <= upper(v_cur) then
      v_cur := tstzrange(lower(v_cur), greatest(upper(v_cur), r.e), '[)');
    else
      v_out := v_out || v_cur;
      v_cur := tstzrange(r.s, r.e, '[)');
    end if;
  end loop;
  if v_cur is not null then
    v_out := v_out || v_cur;
  end if;
  return v_out;
end;
$$;

-- End of work for a start inside the given windows, or null when it does not fit.
create or replace function private.compute_end(
  p_windows tstzrange[], p_start timestamptz, p_work_min int, p_multi_day boolean)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_remaining numeric := p_work_min * 60;
  v_cur timestamptz := p_start;
  v_avail numeric;
  v_started boolean := false;
  w tstzrange;
begin
  if p_windows is null or p_work_min is null or p_work_min <= 0 then
    return null;
  end if;
  foreach w in array p_windows loop
    if not v_started then
      if p_start >= lower(w) and p_start < upper(w) then
        v_started := true;
      else
        continue;
      end if;
    else
      v_cur := lower(w);
    end if;
    v_avail := extract(epoch from upper(w)) - extract(epoch from v_cur);
    if v_remaining <= v_avail then
      return v_cur + make_interval(secs => v_remaining);
    end if;
    if not p_multi_day then
      return null;
    end if;
    v_remaining := v_remaining - v_avail;
  end loop;
  return null;
end;
$$;

-- True when p_start lies on the slot grid of the window containing it.
create or replace function private.is_on_grid(p_windows tstzrange[], p_start timestamptz, p_step_min int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1 from unnest(p_windows) w
    where p_start >= lower(w) and p_start < upper(w)
      and mod((extract(epoch from p_start) - extract(epoch from lower(w)))::numeric, (p_step_min * 60)::numeric) = 0
  )
$$;

-- Price/duration/resources for a service + body type + add-ons, from the CURRENT catalog.
create or replace function private.plan_service(
  p_tenant uuid, p_service_id uuid, p_body_type text, p_addon_ids uuid[], p_for_client boolean)
returns private.service_plan
language plpgsql
stable
set search_path = ''
as $$
declare
  s public.services;
  v public.service_variants;
  a record;
  p private.service_plan;
  v_items jsonb;
  v_count int := 0;
  v_addons uuid[] := coalesce(p_addon_ids, '{}');
begin
  select * into s from public.services where tenant_id = p_tenant and id = p_service_id;
  if not found or not s.active or (p_for_client and not s.bookable_online) then
    perform private.fail('SERVICE_NOT_FOUND', 'Услуга недоступна для записи');
  end if;
  if p_body_type is not null and s.allowed_body_types is not null
     and not (p_body_type = any (s.allowed_body_types)) then
    perform private.fail('BODY_TYPE_NOT_SUPPORTED', 'Эта услуга не выполняется для такого типа кузова');
  end if;
  if p_body_type is not null then
    select * into v from public.service_variants where service_id = s.id and body_type = p_body_type;
  end if;

  p.service_id := s.id;
  p.service_name := s.name;
  p.body_type := p_body_type;
  p.work_minutes := coalesce(v.duration_min, s.duration_min);
  p.price_cents := coalesce(v.price_cents, s.price_cents);
  p.buffer_before_min := s.buffer_before_min;
  p.buffer_after_min := s.buffer_after_min;
  p.multi_day := s.multi_day;
  p.resource_types := s.resource_types;
  p.requires_confirmation := s.requires_confirmation;
  v_items := jsonb_build_array(jsonb_build_object(
    'kind', 'service', 'ref_id', s.id, 'name', s.name, 'price_cents', p.price_cents, 'minutes', p.work_minutes));

  if cardinality(v_addons) > 20 or (select count(distinct x) from unnest(v_addons) x) <> cardinality(v_addons) then
    perform private.fail('INVALID_ADDONS', 'Некорректный список дополнительных опций');
  end if;
  for a in
    select * from public.service_addons
    where tenant_id = p_tenant and service_id = s.id and id = any (v_addons) and active
    order by sort_order, name
  loop
    v_count := v_count + 1;
    p.price_cents := p.price_cents + a.price_cents;
    p.work_minutes := p.work_minutes + a.duration_min;
    v_items := v_items || jsonb_build_object(
      'kind', 'addon', 'ref_id', a.id, 'name', a.name, 'price_cents', a.price_cents, 'minutes', a.duration_min);
  end loop;
  if v_count <> cardinality(v_addons) then
    perform private.fail('ADDON_NOT_FOUND', 'Дополнительная опция недоступна');
  end if;
  p.items := v_items;
  return p;
end;
$$;

-- Free slots for a plan over [p_from_day, p_from_day + p_days) tenant-local days.
-- p_mode: 'client' applies notice and horizon; 'owner' only excludes the past.
create or replace function private.availability(
  p_tenant uuid, p_plan private.service_plan, p_from_day date, p_days int, p_mode text,
  p_ignore_booking uuid default null)
returns table (starts_at timestamptz, ends_at timestamptz, local_day date, local_time text, free_resources int)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text;
  st public.tenant_settings;
  v_windows tstzrange[];
  v_earliest timestamptz;
  v_latest timestamptz;
  v_step interval;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  w tstzrange;
  v_slot timestamptz;
  v_end timestamptz;
  v_range tstzrange;
  v_free int;
  v_days int := least(greatest(coalesce(p_days, 1), 1), 31);
begin
  select timezone into v_tz from public.tenants where id = p_tenant;
  select * into st from public.tenant_settings where tenant_id = p_tenant;
  if p_mode = 'client' then
    v_earliest := now() + make_interval(mins => st.min_notice_min);
    v_latest := now() + make_interval(days => st.horizon_days);
  else
    v_earliest := now();
    v_latest := now() + interval '400 days';
  end if;
  v_windows := private.working_windows(p_tenant, p_from_day - 1,
    p_from_day + v_days + case when p_plan.multi_day then 31 else 1 end);
  v_from_ts := (p_from_day::timestamp) at time zone v_tz;
  v_to_ts := ((p_from_day + v_days)::timestamp) at time zone v_tz;
  v_step := make_interval(mins => st.slot_step_min);

  foreach w in array v_windows loop
    continue when upper(w) <= v_from_ts or lower(w) >= v_to_ts;
    v_slot := lower(w);
    while v_slot < upper(w) and v_slot < v_to_ts loop
      if v_slot >= v_from_ts and v_slot >= v_earliest and v_slot <= v_latest then
        v_end := private.compute_end(v_windows, v_slot, p_plan.work_minutes, p_plan.multi_day);
        if v_end is not null then
          v_range := tstzrange(v_slot - make_interval(mins => p_plan.buffer_before_min),
                               v_end + make_interval(mins => p_plan.buffer_after_min), '[)');
          select count(*) into v_free
          from public.resources r
          where r.tenant_id = p_tenant and r.active and r.type = any (p_plan.resource_types)
            and not exists (
              select 1 from public.resource_occupancies o
              where o.resource_id = r.id and o.released_at is null and o.during && v_range
                and (p_ignore_booking is null or o.booking_id is distinct from p_ignore_booking));
          if v_free > 0 then
            starts_at := v_slot;
            ends_at := v_end;
            local_day := (v_slot at time zone v_tz)::date;
            local_time := to_char(v_slot at time zone v_tz, 'HH24:MI');
            free_resources := v_free;
            return next;
          end if;
        end if;
      end if;
      v_slot := v_slot + v_step;
    end loop;
  end loop;
end;
$$;

-- Validates the requested start and returns the end of work. Raises on any violation.
create or replace function private.check_start(
  p_tenant uuid, p_start timestamptz, p_work_min int, p_multi_day boolean, p_mode text,
  p_allow_outside_hours boolean)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text;
  st public.tenant_settings;
  v_windows tstzrange[];
  v_end timestamptz;
  v_local_day date;
begin
  select timezone into v_tz from public.tenants where id = p_tenant;
  select * into st from public.tenant_settings where tenant_id = p_tenant;
  if p_start is null then
    perform private.fail('INVALID_START', 'Не указано время');
  end if;
  if p_mode in ('client', 'assistant') then
    if p_start < now() + make_interval(mins => st.min_notice_min) then
      perform private.fail('TOO_SOON', 'Это время уже недоступно для онлайн-записи');
    end if;
    if p_start > now() + make_interval(days => st.horizon_days) then
      perform private.fail('TOO_FAR', 'Запись на эту дату ещё не открыта');
    end if;
  elsif p_start < now() - interval '1 day' then
    perform private.fail('IN_PAST', 'Нельзя создать запись в прошлом');
  end if;

  if p_allow_outside_hours and p_mode = 'owner' then
    return p_start + make_interval(mins => p_work_min);
  end if;

  v_local_day := (p_start at time zone v_tz)::date;
  v_windows := private.working_windows(p_tenant, v_local_day - 1,
    v_local_day + case when p_multi_day then 32 else 2 end);
  if p_mode in ('client', 'assistant') and not private.is_on_grid(v_windows, p_start, st.slot_step_min) then
    perform private.fail('OUTSIDE_WORKING_HOURS', 'Выбранное время не входит в расписание студии');
  end if;
  v_end := private.compute_end(v_windows, p_start, p_work_min, p_multi_day);
  if v_end is null then
    perform private.fail('OUTSIDE_WORKING_HOURS', 'Работа не помещается в рабочее время студии');
  end if;
  return v_end;
end;
$$;

-- Resources able to serve the plan, the preferred ones first.
create or replace function private.candidate_resources(p_tenant uuid, p_types text[], p_prefer uuid[])
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select r.id
  from public.resources r
  where r.tenant_id = p_tenant and r.active and r.type = any (p_types)
  order by coalesce(array_position(p_prefer, r.id), 1000), r.sort_order, r.key
$$;

-- Creates a booking and its occupancy atomically. Returns the booking id.
create or replace function private.place_booking(
  p_tenant uuid,
  p_plan private.service_plan,
  p_starts_at timestamptz,
  p_mode text,
  p_allow_outside_hours boolean,
  p_customer_id uuid,
  p_vehicle_id uuid,
  p_profile_id uuid,
  p_customer_note text,
  p_internal_note text,
  p_preferred_resource uuid,
  p_status text,
  p_actor_user uuid,
  p_is_demo boolean)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  t public.tenants;
  st public.tenant_settings;
  v_end timestamptz;
  v_range tstzrange;
  v_status text;
  v_resource uuid;
  v_booking uuid;
  v_code text;
  v_active int;
  v_placed boolean := false;
  v_item jsonb;
  v_i int := 0;
begin
  select * into t from public.tenants where id = p_tenant;
  select * into st from public.tenant_settings where tenant_id = p_tenant;

  -- Serialize bookings of one customer (active-booking limit, duplicate taps).
  perform 1 from public.customers where tenant_id = p_tenant and id = p_customer_id for update;
  if not found then
    perform private.fail('CUSTOMER_NOT_FOUND', 'Клиент не найден');
  end if;
  if p_mode in ('client', 'assistant') then
    select count(*) into v_active from public.bookings
    where tenant_id = p_tenant and customer_id = p_customer_id
      and status in ('pending', 'confirmed') and starts_at > now();
    if v_active >= st.max_active_bookings_per_phone then
      perform private.fail('TOO_MANY_ACTIVE_BOOKINGS', 'У вас уже есть максимальное число активных записей');
    end if;
  end if;

  v_end := private.check_start(p_tenant, p_starts_at, p_plan.work_minutes, p_plan.multi_day, p_mode,
                               coalesce(p_allow_outside_hours, false));
  v_range := tstzrange(p_starts_at - make_interval(mins => p_plan.buffer_before_min),
                       v_end + make_interval(mins => p_plan.buffer_after_min), '[)');

  if p_mode = 'owner' and p_status is not null then
    if p_status not in ('pending', 'confirmed') then
      perform private.fail('INVALID_STATUS', 'Недопустимый статус новой записи');
    end if;
    v_status := p_status;
  elsif p_mode <> 'owner' and (st.requires_confirmation or p_plan.requires_confirmation) then
    v_status := 'pending';
  else
    v_status := 'confirmed';
  end if;

  for v_resource in
    select * from private.candidate_resources(p_tenant, p_plan.resource_types,
      case when p_preferred_resource is null then '{}'::uuid[] else array[p_preferred_resource] end)
  loop
    if p_preferred_resource is not null and p_mode = 'owner' and v_resource <> p_preferred_resource then
      exit; -- an owner who picked a lane gets exactly that lane or an error
    end if;
    for attempt in 1 .. 5 loop
      v_code := private.random_code(6);
      begin
        insert into public.bookings (
          tenant_id, code, customer_id, vehicle_id, client_profile_id, service_id, resource_id, status,
          starts_at, ends_at, service_name, body_type, work_minutes, buffer_before_min, buffer_after_min,
          multi_day, price_cents, currency, customer_note, internal_note, source, is_demo, confirmed_at)
        values (
          p_tenant, v_code, p_customer_id, p_vehicle_id, p_profile_id, p_plan.service_id, v_resource, v_status,
          p_starts_at, v_end, p_plan.service_name, p_plan.body_type, p_plan.work_minutes,
          p_plan.buffer_before_min, p_plan.buffer_after_min, p_plan.multi_day, p_plan.price_cents, t.currency,
          coalesce(p_customer_note, ''), coalesce(p_internal_note, ''), p_mode, coalesce(p_is_demo, false),
          case when v_status = 'confirmed' then now() end)
        returning id into v_booking;
        insert into public.resource_occupancies (tenant_id, resource_id, kind, booking_id, during, created_by)
        values (p_tenant, v_resource, 'booking', v_booking, v_range, p_actor_user);
        v_placed := true;
        exit;
      exception
        when exclusion_violation then
          exit; -- this resource is taken: the subtransaction (booking row too) is rolled back
        when unique_violation then
          if attempt = 5 then raise; end if; -- booking code collision: retry with a new code
      end;
    end loop;
    exit when v_placed;
  end loop;

  if not v_placed then
    perform private.fail('SLOT_UNAVAILABLE', 'Это время уже занято. Выберите другое');
  end if;

  for v_item in select * from jsonb_array_elements(p_plan.items) loop
    insert into public.booking_items (tenant_id, booking_id, kind, ref_id, name, price_cents, minutes, sort_order)
    values (p_tenant, v_booking, v_item ->> 'kind', (v_item ->> 'ref_id')::uuid, v_item ->> 'name',
            (v_item ->> 'price_cents')::bigint, (v_item ->> 'minutes')::int, v_i);
    v_i := v_i + 1;
  end loop;

  insert into public.booking_events (tenant_id, booking_id, event, data, actor, actor_user)
  values (p_tenant, v_booking, 'created',
          jsonb_build_object('starts_at', p_starts_at, 'resource_id', v_resource, 'price_cents', p_plan.price_cents),
          case p_mode when 'owner' then 'owner' when 'assistant' then 'assistant' else 'client' end, p_actor_user);
  perform private.enqueue_booking_event(v_booking, 'booking.created');
  return v_booking;
end;
$$;

-- Moves a booking atomically. The old occupancy is released and the new one inserted in
-- the same transaction; if no resource is free the whole statement fails and the
-- original booking and occupancy stay exactly as they were.
create or replace function private.move_booking(
  p_booking uuid, p_new_start timestamptz, p_mode text, p_preferred_resource uuid,
  p_allow_outside_hours boolean, p_actor_user uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings;
  st public.tenant_settings;
  v_types text[];
  v_end timestamptz;
  v_range tstzrange;
  v_resource uuid;
  v_placed boolean := false;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    perform private.fail('BOOKING_NOT_FOUND', 'Запись не найдена');
  end if;
  select * into st from public.tenant_settings where tenant_id = b.tenant_id;
  if b.status not in ('pending', 'confirmed') then
    perform private.fail('INVALID_STATUS', 'Эту запись уже нельзя перенести');
  end if;
  if p_mode in ('client', 'assistant') and b.starts_at < now() + make_interval(hours => st.cancel_cutoff_hours) then
    perform private.fail('CUTOFF_PASSED', 'Перенести запись онлайн уже нельзя — позвоните в студию');
  end if;
  -- Same start on the same resource: nothing to do (idempotent retry).
  if b.starts_at = p_new_start and (p_preferred_resource is null or p_preferred_resource = b.resource_id) then
    return b.id;
  end if;

  v_end := private.check_start(b.tenant_id, p_new_start, b.work_minutes, b.multi_day, p_mode,
                               coalesce(p_allow_outside_hours, false));
  v_range := tstzrange(p_new_start - make_interval(mins => b.buffer_before_min),
                       v_end + make_interval(mins => b.buffer_after_min), '[)');
  select s.resource_types into v_types from public.services s where s.tenant_id = b.tenant_id and s.id = b.service_id;

  update public.resource_occupancies
     set released_at = now(), release_reason = 'rescheduled'
   where booking_id = b.id and kind = 'booking' and released_at is null;

  for v_resource in
    select * from private.candidate_resources(b.tenant_id, v_types,
      array_remove(array[p_preferred_resource, b.resource_id], null))
  loop
    if p_preferred_resource is not null and v_resource <> p_preferred_resource then
      exit;
    end if;
    begin
      insert into public.resource_occupancies (tenant_id, resource_id, kind, booking_id, during, created_by)
      values (b.tenant_id, v_resource, 'booking', b.id, v_range, p_actor_user);
      v_placed := true;
    exception when exclusion_violation then
      null;
    end;
    exit when v_placed;
  end loop;

  if not v_placed then
    -- Raising aborts the transaction: the release above is rolled back too.
    perform private.fail('SLOT_UNAVAILABLE', 'Это время уже занято. Выберите другое');
  end if;

  update public.bookings
     set starts_at = p_new_start, ends_at = v_end, resource_id = v_resource, version = version + 1
   where id = b.id;
  insert into public.booking_events (tenant_id, booking_id, event, data, actor, actor_user)
  values (b.tenant_id, b.id, 'moved',
          jsonb_build_object('from', b.starts_at, 'to', p_new_start, 'from_resource', b.resource_id, 'to_resource', v_resource),
          case p_mode when 'owner' then 'owner' when 'assistant' then 'assistant' else 'client' end, p_actor_user);
  perform private.enqueue_booking_event(b.id, 'booking.moved');
  return b.id;
end;
$$;

create or replace function private.cancel_booking(p_booking uuid, p_mode text, p_reason text, p_actor_user uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings;
  st public.tenant_settings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    perform private.fail('BOOKING_NOT_FOUND', 'Запись не найдена');
  end if;
  if b.status = 'cancelled' then
    return b.id; -- idempotent
  end if;
  if b.status not in ('pending', 'confirmed') then
    perform private.fail('INVALID_STATUS', 'Эту запись уже нельзя отменить');
  end if;
  select * into st from public.tenant_settings where tenant_id = b.tenant_id;
  if p_mode in ('client', 'assistant') and b.starts_at < now() + make_interval(hours => st.cancel_cutoff_hours) then
    perform private.fail('CUTOFF_PASSED', 'Отменить запись онлайн уже нельзя — позвоните в студию');
  end if;

  update public.bookings
     set status = 'cancelled', cancelled_at = now(), version = version + 1,
         cancelled_by = case when p_mode = 'owner' then 'owner' when p_mode = 'system' then 'system' else 'client' end,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = b.id;
  update public.resource_occupancies
     set released_at = now(), release_reason = 'cancelled'
   where booking_id = b.id and kind = 'booking' and released_at is null;
  insert into public.booking_events (tenant_id, booking_id, event, data, actor, actor_user)
  values (b.tenant_id, b.id, 'cancelled', jsonb_build_object('reason', p_reason),
          case p_mode when 'owner' then 'owner' when 'assistant' then 'assistant' when 'system' then 'system' else 'client' end,
          p_actor_user);
  perform private.enqueue_booking_event(b.id, 'booking.cancelled');
  return b.id;
end;
$$;

-- Owner-side status machine (cancellation has its own function).
--   pending -> confirmed | cancelled
--   confirmed -> in_progress | completed | no_show | cancelled
--   in_progress -> completed
create or replace function private.transition_booking(p_booking uuid, p_status text, p_actor_user uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    perform private.fail('BOOKING_NOT_FOUND', 'Запись не найдена');
  end if;
  if b.status = p_status then
    return b.id;
  end if;
  if not ((b.status = 'pending' and p_status = 'confirmed')
       or (b.status = 'confirmed' and p_status in ('in_progress', 'completed', 'no_show'))
       or (b.status = 'in_progress' and p_status = 'completed')) then
    perform private.fail('INVALID_TRANSITION', 'Недопустимая смена статуса');
  end if;
  if p_status in ('in_progress', 'completed', 'no_show') and b.starts_at > now() + interval '12 hours' then
    perform private.fail('TOO_EARLY', 'Запись ещё не началась');
  end if;

  update public.bookings
     set status = p_status, version = version + 1,
         confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
         started_at = case when p_status = 'in_progress' then now() else started_at end,
         completed_at = case when p_status = 'completed' then now() else completed_at end
   where id = b.id;
  if p_status = 'no_show' then
    update public.resource_occupancies set released_at = now(), release_reason = 'no_show'
     where booking_id = b.id and kind = 'booking' and released_at is null;
  end if;
  insert into public.booking_events (tenant_id, booking_id, event, data, actor, actor_user)
  values (b.tenant_id, b.id,
          case p_status when 'in_progress' then 'started' else p_status end,
          jsonb_build_object('from', b.status), 'owner', p_actor_user);
  if p_status = 'confirmed' then
    perform private.enqueue_booking_event(b.id, 'booking.confirmed');
  end if;
  return b.id;
end;
$$;

-- Manual block of a resource. Uses the same ledger, so it conflicts with bookings.
create or replace function private.place_block(
  p_tenant uuid, p_resource uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_reason text, p_title text, p_note text, p_actor_user uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_ends_at <= p_starts_at then
    perform private.fail('INVALID_RANGE', 'Окончание должно быть позже начала');
  end if;
  if p_ends_at - p_starts_at > interval '62 days' then
    perform private.fail('INVALID_RANGE', 'Блокировка не может быть длиннее 62 дней');
  end if;
  perform 1 from public.resources where tenant_id = p_tenant and id = p_resource;
  if not found then
    perform private.fail('RESOURCE_NOT_FOUND', 'Ресурс не найден');
  end if;
  begin
    insert into public.resource_occupancies (tenant_id, resource_id, kind, block_reason, title, note, during, created_by)
    values (p_tenant, p_resource, 'block', p_reason, nullif(btrim(coalesce(p_title, '')), ''),
            nullif(btrim(coalesce(p_note, '')), ''), tstzrange(p_starts_at, p_ends_at, '[)'), p_actor_user)
    returning id into v_id;
  exception when exclusion_violation then
    perform private.fail('SLOT_UNAVAILABLE', 'На это время у ресурса уже есть запись или блокировка');
  end;
  return v_id;
end;
$$;

-- JSON shape of one booking, shared by the client and owner APIs.
create or replace function private.booking_json(p_booking uuid, p_for_client boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id,
    'code', b.code,
    'status', b.status,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at,
    'occupied_until', b.ends_at + make_interval(mins => b.buffer_after_min),
    'local_start', to_char(b.starts_at at time zone t.timezone, 'YYYY-MM-DD"T"HH24:MI'),
    'local_end', to_char(b.ends_at at time zone t.timezone, 'YYYY-MM-DD"T"HH24:MI'),
    'timezone', t.timezone,
    'service', jsonb_build_object('id', b.service_id, 'name', b.service_name),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('kind', i.kind, 'name', i.name, 'price_cents', i.price_cents, 'minutes', i.minutes)
                       order by i.sort_order)
      from public.booking_items i where i.tenant_id = b.tenant_id and i.booking_id = b.id), '[]'),
    'work_minutes', b.work_minutes,
    'buffer_before_min', b.buffer_before_min,
    'buffer_after_min', b.buffer_after_min,
    'multi_day', b.multi_day,
    'price_cents', b.price_cents,
    'currency', b.currency,
    'body_type', b.body_type,
    'vehicle', (select jsonb_build_object('id', v.id, 'nickname', v.nickname, 'make', v.make, 'model', v.model,
                                          'year', v.year, 'body_type', v.body_type, 'color', v.color, 'plate', v.plate)
                from public.customer_vehicles v where v.tenant_id = b.tenant_id and v.id = b.vehicle_id),
    'resource', (select jsonb_build_object('id', r.id, 'name', r.name, 'type', r.type)
                 from public.resources r where r.tenant_id = b.tenant_id and r.id = b.resource_id),
    'customer_note', b.customer_note,
    'client_note', b.client_note,
    'source', b.source,
    'version', b.version,
    'created_at', b.created_at,
    'cancelled_at', b.cancelled_at,
    'completed_at', b.completed_at,
    'is_demo', b.is_demo,
    'can_modify', (b.status in ('pending', 'confirmed')
                   and (not p_for_client or b.starts_at >= now() + make_interval(hours => st.cancel_cutoff_hours))),
    'modify_deadline', b.starts_at - make_interval(hours => st.cancel_cutoff_hours)
  )
  || case when p_for_client then '{}'::jsonb else jsonb_build_object(
       'internal_note', b.internal_note,
       'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone_e164, 'email', c.email)
                    from public.customers c where c.tenant_id = b.tenant_id and c.id = b.customer_id),
       'paid_cents', coalesce((select sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end)
                               from public.payments p where p.tenant_id = b.tenant_id and p.booking_id = b.id), 0)
     ) end
  from public.bookings b
  join public.tenants t on t.id = b.tenant_id
  join public.tenant_settings st on st.tenant_id = b.tenant_id
  where b.id = p_booking
$$;
