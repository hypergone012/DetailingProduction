-- Public (client) API. Called only by the `public-api` Edge Function with the service role:
-- EXECUTE is granted to service_role alone. The Edge Function validates input with Zod,
-- normalizes phones, applies rate limits and derives capability tokens; these functions
-- resolve the tenant from the slug, never trust ids across tenants and do all writes in a
-- single transaction.

create table private.idempotency_keys (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  scope text not null,
  key text not null check (length(key) between 8 and 100),
  request_hash text not null check (length(request_hash) between 16 and 128),
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, scope, key)
);

-- Claims an idempotency key. Returns the stored response for a replay, null for a fresh
-- claim. A concurrent request with the same key blocks on the primary key until the first
-- one commits (then replays) or rolls back (then proceeds).
create or replace function private.claim_idempotency(p_tenant uuid, p_scope text, p_key text, p_request_hash text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r private.idempotency_keys;
begin
  if p_key is null then
    perform private.fail('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required');
  end if;
  insert into private.idempotency_keys (tenant_id, scope, key, request_hash)
  values (p_tenant, p_scope, p_key, p_request_hash)
  on conflict do nothing;
  if found then
    return null;
  end if;
  select * into r from private.idempotency_keys where tenant_id = p_tenant and scope = p_scope and key = p_key;
  if r.request_hash <> p_request_hash then
    perform private.fail('IDEMPOTENCY_CONFLICT', 'Этот ключ уже использован для другого запроса');
  end if;
  return coalesce(r.response, '{}'::jsonb);
end;
$$;

create or replace function private.store_idempotency(p_tenant uuid, p_scope text, p_key text, p_response jsonb)
returns void
language sql
set search_path = ''
as $$
  update private.idempotency_keys set response = p_response
  where tenant_id = p_tenant and scope = p_scope and key = p_key
$$;

-- Public tenants only (demo or live). Draft and suspended studios are invisible.
create or replace function private.public_tenant(p_slug text)
returns public.tenants
language plpgsql
stable
set search_path = ''
as $$
declare
  t public.tenants;
begin
  select * into t from public.tenants where slug = lower(p_slug) and status in ('demo', 'live');
  if not found then
    perform private.fail('TENANT_NOT_FOUND', 'Студия не найдена');
  end if;
  return t;
end;
$$;

create or replace function private.profile_by_key(p_tenant uuid, p_key_hash bytea)
returns public.client_profiles
language plpgsql
set search_path = ''
as $$
declare
  p public.client_profiles;
begin
  select * into p from public.client_profiles
  where key_hash = p_key_hash and tenant_id = p_tenant and revoked_at is null;
  if not found then
    perform private.fail('PROFILE_NOT_FOUND', 'Профиль не найден на этом устройстве');
  end if;
  if p.last_seen_at < now() - interval '1 hour' then
    update public.client_profiles set last_seen_at = now() where id = p.id;
  end if;
  return p;
end;
$$;

-- Booking reachable by a client: through its access token, or through the profile that
-- created it. Anything else is NOT_FOUND.
create or replace function private.client_booking_id(
  p_tenant uuid, p_token_hash bytea, p_profile_key_hash bytea, p_booking uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  p public.client_profiles;
begin
  if p_token_hash is not null then
    update public.booking_access_tokens
       set last_used_at = now()
     where token_hash = p_token_hash and tenant_id = p_tenant and revoked_at is null
    returning booking_id into v_id;
    if v_id is not null and (p_booking is null or p_booking = v_id) then
      return v_id;
    end if;
  elsif p_profile_key_hash is not null and p_booking is not null then
    p := private.profile_by_key(p_tenant, p_profile_key_hash);
    select id into v_id from public.bookings
    where tenant_id = p_tenant and id = p_booking and client_profile_id = p.id;
    if v_id is not null then
      return v_id;
    end if;
  end if;
  perform private.fail('BOOKING_NOT_FOUND', 'Запись не найдена или ссылка недействительна');
  return null;
end;
$$;

create or replace function private.media_json(m public.media)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', m.id, 'key', m.key, 'kind', m.kind, 'bucket', m.bucket, 'path', m.path,
    'variants', m.variants, 'width', m.width, 'height', m.height, 'alt', m.alt, 'caption', m.caption,
    'service_id', m.service_id, 'sort_order', m.sort_order)
$$;

-- Minimal public facts about a studio (manifest, uploads, routing).
create or replace function public.api_public_tenant_ref(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := private.public_tenant(p_slug);
  return jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'timezone', t.timezone,
                            'locale', t.locale, 'currency', t.currency);
end;
$$;

-- Everything the client app needs to render a studio.
create or replace function public.api_public_bootstrap(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  st public.tenant_settings;
begin
  t := private.public_tenant(p_slug);
  select * into st from public.tenant_settings where tenant_id = t.id;
  return jsonb_build_object(
    'tenant', jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status,
      'timezone', t.timezone, 'locale', t.locale, 'currency', t.currency),
    'profile', jsonb_build_object('tagline', st.tagline, 'description', st.description, 'address', st.address,
      'map_url', st.map_url, 'phone', st.phone, 'email', st.email, 'website', st.website, 'socials', st.socials),
    'branding', st.branding,
    'seo', st.seo,
    'features', st.features,
    'policy', jsonb_build_object('slot_step_min', st.slot_step_min, 'min_notice_min', st.min_notice_min,
      'horizon_days', st.horizon_days, 'cancel_cutoff_hours', st.cancel_cutoff_hours,
      'requires_confirmation', st.requires_confirmation),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', to_char(h.opens, 'HH24:MI'),
                                                           'closes', case when h.closes = '24:00' then '24:00' else to_char(h.closes, 'HH24:MI') end)
                                        order by h.weekday, h.opens)
                       from public.business_hours h where h.tenant_id = t.id), '[]'),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'closed', x.closed,
                                                                'opens', to_char(x.opens, 'HH24:MI'), 'closes', to_char(x.closes, 'HH24:MI'),
                                                                'note', x.note) order by x.day)
                            from public.business_exceptions x
                            where x.tenant_id = t.id and x.day between (now() at time zone t.timezone)::date
                                                               and (now() at time zone t.timezone)::date + 90), '[]'),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'key', s.key, 'name', s.name, 'category', s.category, 'summary', s.summary,
        'description', s.description, 'duration_min', s.duration_min, 'buffer_before_min', s.buffer_before_min,
        'buffer_after_min', s.buffer_after_min, 'price_cents', s.price_cents, 'multi_day', s.multi_day,
        'requires_confirmation', (s.requires_confirmation or st.requires_confirmation),
        'allowed_body_types', s.allowed_body_types, 'benefits', s.benefits, 'prep_notes', s.prep_notes,
        'restrictions', s.restrictions, 'repeat_interval_days', s.repeat_interval_days,
        'recommended_ids', coalesce((select jsonb_agg(r.id order by array_position(s.recommended_keys, r.key::text))
                                     from public.services r
                                     where r.tenant_id = t.id and r.key = any (s.recommended_keys)
                                       and r.active and r.bookable_online), '[]'),
        'variants', coalesce((select jsonb_agg(jsonb_build_object('body_type', v.body_type, 'price_cents', v.price_cents,
                                                                   'duration_min', v.duration_min) order by v.body_type)
                              from public.service_variants v where v.service_id = s.id), '[]'),
        'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'key', a.key, 'name', a.name,
                                                                 'description', a.description, 'price_cents', a.price_cents,
                                                                 'duration_min', a.duration_min) order by a.sort_order, a.name)
                            from public.service_addons a where a.tenant_id = t.id and a.service_id = s.id and a.active), '[]')
      ) order by s.sort_order, s.name)
      from public.services s
      where s.tenant_id = t.id and s.active and s.bookable_online), '[]'),
    'media', coalesce((select jsonb_agg(private.media_json(m) order by m.sort_order, m.created_at)
                       from public.media m where m.tenant_id = t.id and m.bucket = 'public-media'), '[]')
  );
end;
$$;

create or replace function public.api_public_availability(
  p_slug text, p_service_id uuid, p_body_type text, p_addon_ids uuid[], p_from_day date, p_days int,
  p_ignore_booking uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_plan private.service_plan;
begin
  t := private.public_tenant(p_slug);
  v_plan := private.plan_service(t.id, p_service_id, p_body_type, p_addon_ids, true);
  return jsonb_build_object(
    'service_id', v_plan.service_id,
    'price_cents', v_plan.price_cents,
    'work_minutes', v_plan.work_minutes,
    'buffer_after_min', v_plan.buffer_after_min,
    'multi_day', v_plan.multi_day,
    'currency', t.currency,
    'timezone', t.timezone,
    'items', v_plan.items,
    'slots', coalesce((select jsonb_agg(jsonb_build_object('starts_at', a.starts_at, 'ends_at', a.ends_at,
                                                            'local_day', a.local_day, 'local_time', a.local_time)
                                         order by a.starts_at)
                       from private.availability(t.id, v_plan, p_from_day, p_days, 'client', p_ignore_booking) a), '[]'));
end;
$$;

-- Finds or creates the CRM customer for a phone. A client booking never renames an
-- existing customer (the studio may have corrected the name).
create or replace function private.upsert_customer(p_tenant uuid, p_name text, p_phone text, p_email text, p_is_demo boolean)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.customers (tenant_id, name, phone_e164, email, is_demo)
  values (p_tenant, btrim(p_name), p_phone, nullif(btrim(coalesce(p_email, '')), ''), coalesce(p_is_demo, false))
  on conflict (tenant_id, phone_e164) where phone_e164 is not null
  do update set email = coalesce(public.customers.email, excluded.email)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.insert_vehicle(
  p_tenant uuid, p_customer uuid, p_profile uuid, p_v jsonb, p_is_demo boolean)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_profile is not null and (select count(*) from public.customer_vehicles
                                where tenant_id = p_tenant and client_profile_id = p_profile and archived_at is null) >= 20 then
    perform private.fail('TOO_MANY_VEHICLES', 'В гараже уже 20 автомобилей');
  end if;
  insert into public.customer_vehicles (tenant_id, customer_id, client_profile_id, nickname, make, model, generation,
                                        year, body_type, color, plate, client_comment, is_demo)
  values (p_tenant, p_customer, p_profile, nullif(btrim(coalesce(p_v ->> 'nickname', '')), ''),
          btrim(p_v ->> 'make'), btrim(p_v ->> 'model'), nullif(btrim(coalesce(p_v ->> 'generation', '')), ''),
          (p_v ->> 'year')::int, p_v ->> 'body_type', nullif(btrim(coalesce(p_v ->> 'color', '')), ''),
          nullif(upper(btrim(coalesce(p_v ->> 'plate', ''))), ''), coalesce(p_v ->> 'comment', ''), coalesce(p_is_demo, false))
  returning id into v_id;
  return v_id;
end;
$$;

-- Creates a booking for a client. One transaction: profile, customer, vehicle, booking,
-- occupancy, access token, outbox jobs and the idempotency record.
--   p_profile_key_hash: SHA-256 of the device key. p_create_profile = true when the device
--   had no key yet (the Edge Function derives the key from the idempotency key, so a
--   retry produces the same key and finds the same profile).
--   p_token_hash: SHA-256 of the booking access token (also derived deterministically).
create or replace function public.api_public_create_booking(
  p_slug text,
  p_idempotency_key text,
  p_request_hash text,
  p_payload jsonb,
  p_profile_key_hash bytea,
  p_create_profile boolean,
  p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  p public.client_profiles;
  v_replay jsonb;
  v_customer uuid;
  v_vehicle uuid;
  v_body text;
  v_plan private.service_plan;
  v_booking uuid;
  v_contact jsonb := p_payload -> 'contact';
  v_vehicle_in jsonb := p_payload -> 'vehicle';
  v_addons uuid[];
  v_response jsonb;
begin
  t := private.public_tenant(p_slug);
  v_replay := private.claim_idempotency(t.id, 'booking.create', p_idempotency_key, p_request_hash);
  if v_replay is not null then
    return jsonb_build_object('booking', private.booking_json((v_replay ->> 'booking_id')::uuid, true),
                              'profile_id', v_replay -> 'profile_id', 'replayed', true);
  end if;

  if p_create_profile then
    insert into public.client_profiles (tenant_id, key_hash, is_demo)
    values (t.id, p_profile_key_hash, t.status = 'demo')
    on conflict (key_hash) do nothing;
  end if;
  p := private.profile_by_key(t.id, p_profile_key_hash);

  v_customer := private.upsert_customer(t.id, v_contact ->> 'name', v_contact ->> 'phone', v_contact ->> 'email',
                                        t.status = 'demo');
  update public.client_profiles
     set customer_id = v_customer,
         display_name = btrim(v_contact ->> 'name'),
         phone_e164 = v_contact ->> 'phone',
         email = coalesce(nullif(btrim(coalesce(v_contact ->> 'email', '')), ''), email)
   where id = p.id;

  if v_vehicle_in ? 'id' then
    select id, body_type into v_vehicle, v_body from public.customer_vehicles
    where tenant_id = t.id and id = (v_vehicle_in ->> 'id')::uuid and client_profile_id = p.id and archived_at is null;
    if v_vehicle is null then
      perform private.fail('VEHICLE_NOT_FOUND', 'Автомобиль не найден в гараже');
    end if;
    update public.customer_vehicles set customer_id = coalesce(customer_id, v_customer) where id = v_vehicle;
  else
    v_vehicle := private.insert_vehicle(t.id, v_customer, p.id, v_vehicle_in, t.status = 'demo');
    v_body := v_vehicle_in ->> 'body_type';
  end if;

  select coalesce(array_agg(x::uuid), '{}') into v_addons
  from jsonb_array_elements_text(coalesce(p_payload -> 'addon_ids', '[]')) x;
  v_plan := private.plan_service(t.id, (p_payload ->> 'service_id')::uuid, v_body, v_addons, true);
  v_booking := private.place_booking(t.id, v_plan, (p_payload ->> 'starts_at')::timestamptz, 'client', false,
                                     v_customer, v_vehicle, p.id, p_payload ->> 'note', null, null, null, null,
                                     t.status = 'demo');

  insert into public.booking_access_tokens (tenant_id, booking_id, token_hash, purpose)
  values (t.id, v_booking, p_token_hash, 'client')
  on conflict (token_hash) do nothing;

  v_response := jsonb_build_object('booking_id', v_booking, 'profile_id', p.id);
  perform private.store_idempotency(t.id, 'booking.create', p_idempotency_key, v_response);
  return jsonb_build_object('booking', private.booking_json(v_booking, true), 'profile_id', p.id, 'replayed', false);
end;
$$;

create or replace function private.studio_json(p_tenant uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('name', t.name, 'slug', t.slug, 'address', s.address, 'phone', s.phone,
                            'map_url', s.map_url, 'timezone', t.timezone, 'cancel_cutoff_hours', s.cancel_cutoff_hours)
  from public.tenants t join public.tenant_settings s on s.tenant_id = t.id
  where t.id = p_tenant
$$;

create or replace function public.api_public_booking(
  p_slug text, p_token_hash bytea, p_profile_key_hash bytea, p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_id uuid;
begin
  t := private.public_tenant(p_slug);
  v_id := private.client_booking_id(t.id, p_token_hash, p_profile_key_hash, p_booking_id);
  return jsonb_build_object(
    'booking', private.booking_json(v_id, true),
    'studio', private.studio_json(t.id),
    'media', coalesce((select jsonb_agg(private.media_json(m) order by m.kind, m.sort_order)
                       from public.media m
                       where m.tenant_id = t.id and m.booking_id = v_id and m.client_visible), '[]'));
end;
$$;

create or replace function public.api_public_reschedule(
  p_slug text, p_idempotency_key text, p_request_hash text,
  p_token_hash bytea, p_profile_key_hash bytea, p_booking_id uuid, p_starts_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_id uuid;
  v_replay jsonb;
begin
  t := private.public_tenant(p_slug);
  v_id := private.client_booking_id(t.id, p_token_hash, p_profile_key_hash, p_booking_id);
  v_replay := private.claim_idempotency(t.id, 'booking.reschedule', p_idempotency_key, p_request_hash);
  if v_replay is null then
    perform private.move_booking(v_id, p_starts_at, 'client', null, false, null);
    perform private.store_idempotency(t.id, 'booking.reschedule', p_idempotency_key, jsonb_build_object('booking_id', v_id));
  end if;
  return jsonb_build_object('booking', private.booking_json(v_id, true), 'replayed', v_replay is not null);
end;
$$;

create or replace function public.api_public_cancel(
  p_slug text, p_token_hash bytea, p_profile_key_hash bytea, p_booking_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_id uuid;
begin
  t := private.public_tenant(p_slug);
  v_id := private.client_booking_id(t.id, p_token_hash, p_profile_key_hash, p_booking_id);
  perform private.cancel_booking(v_id, 'client', p_reason, null);
  return jsonb_build_object('booking', private.booking_json(v_id, true));
end;
$$;

-- Data-backed suggestions for one vehicle. Every suggestion names its source; nothing is
-- invented: if the data does not support a suggestion, it is not returned.
create or replace function private.vehicle_suggestions(p_tenant uuid, p_vehicle uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with history as (
    select b.service_id, max(b.starts_at) as last_at
    from public.bookings b
    where b.tenant_id = p_tenant and b.vehicle_id = p_vehicle and b.status = 'completed'
    group by b.service_id
  ),
  upcoming as (
    select distinct b.service_id from public.bookings b
    where b.tenant_id = p_tenant and b.vehicle_id = p_vehicle and b.status in ('pending', 'confirmed')
      and b.starts_at > now()
  ),
  last_service as (
    select b.service_id, s.name, s.recommended_keys from public.bookings b
    join public.services s on s.tenant_id = b.tenant_id and s.id = b.service_id
    where b.tenant_id = p_tenant and b.vehicle_id = p_vehicle and b.status = 'completed'
    order by b.starts_at desc limit 1
  ),
  bookable as (
    select s.* from public.services s
    where s.tenant_id = p_tenant and s.active and s.bookable_online
      and s.id not in (select service_id from upcoming)
  ),
  due as (
    select 'repeat_due' as kind, s.id as service_id, s.name as service_name, h.last_at,
           null::int as customers, 1 as prio
    from bookable s join history h on h.service_id = s.id
    where s.repeat_interval_days is not null and h.last_at < now() - make_interval(days => s.repeat_interval_days)
  ),
  recommended as (
    select 'studio_recommends' as kind, s.id, s.name, null::timestamptz, null::int, 2
    from bookable s, last_service l
    where s.key = any (l.recommended_keys) and s.id <> l.service_id
  ),
  often_after as (
    select 'often_after' as kind, s.id, s.name, null::timestamptz, x.customers::int, 3
    from last_service l
    join lateral (
      select b2.service_id, count(distinct b1.customer_id) as customers
      from public.bookings b1
      join public.bookings b2 on b2.tenant_id = b1.tenant_id and b2.customer_id = b1.customer_id
        and b2.starts_at > b1.starts_at and b2.starts_at < b1.starts_at + interval '180 days'
        and b2.service_id <> b1.service_id and b2.status in ('confirmed', 'in_progress', 'completed')
      where b1.tenant_id = p_tenant and b1.service_id = l.service_id and b1.status = 'completed'
      group by b2.service_id
      having count(distinct b1.customer_id) >= 3
    ) x on true
    join bookable s on s.id = x.service_id
  ),
  all_rows as (
    select * from due
    union all select * from recommended
    union all select * from often_after
  ),
  ranked as (
    select distinct on (service_id) * from all_rows order by service_id, prio
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', r.kind, 'service_id', r.service_id, 'service_name', r.service_name, 'last_at', r.last_at,
           'customers', r.customers,
           'after_service', (select name from last_service)) order by r.prio, r.service_name), '[]')
  from (select * from ranked order by prio limit 3) r
$$;

create or replace function private.booking_summary(b public.bookings, p_tz text, p_cutoff_hours int)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', b.id, 'code', b.code, 'status', b.status, 'starts_at', b.starts_at,
    'ends_at', b.ends_at, 'local_start', to_char(b.starts_at at time zone p_tz, 'YYYY-MM-DD"T"HH24:MI'),
    'service_id', b.service_id, 'service_name', b.service_name, 'price_cents', b.price_cents,
    'currency', b.currency, 'vehicle_id', b.vehicle_id, 'client_note', b.client_note,
    'can_modify', b.status in ('pending', 'confirmed') and b.starts_at >= now() + make_interval(hours => p_cutoff_hours),
    'media', coalesce((select jsonb_agg(private.media_json(m) order by m.kind, m.sort_order)
                       from public.media m
                       where m.tenant_id = b.tenant_id and m.booking_id = b.id and m.client_visible), '[]'))
$$;

-- The client's garage and history: vehicles and bookings created through this profile.
create or replace function public.api_public_profile(p_slug text, p_profile_key_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  st public.tenant_settings;
  p public.client_profiles;
begin
  t := private.public_tenant(p_slug);
  select * into st from public.tenant_settings where tenant_id = t.id;
  p := private.profile_by_key(t.id, p_profile_key_hash);
  return jsonb_build_object(
    'profile', jsonb_build_object('id', p.id, 'display_name', p.display_name, 'phone', p.phone_e164,
                                  'email', p.email, 'created_at', p.created_at),
    'vehicles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'nickname', v.nickname, 'make', v.make, 'model', v.model, 'generation', v.generation,
        'year', v.year, 'body_type', v.body_type, 'color', v.color, 'plate', v.plate, 'comment', v.client_comment,
        'created_at', v.created_at,
        'photo', (select private.media_json(m) from public.media m where m.tenant_id = t.id and m.id = v.photo_media_id),
        'suggestions', private.vehicle_suggestions(t.id, v.id)
      ) order by v.created_at)
      from public.customer_vehicles v
      where v.tenant_id = t.id and v.client_profile_id = p.id and v.archived_at is null), '[]'),
    'bookings', coalesce((
      select jsonb_agg(private.booking_summary(b, t.timezone, st.cancel_cutoff_hours) order by b.starts_at desc)
      from public.bookings b
      where b.tenant_id = t.id and b.client_profile_id = p.id), '[]'));
end;
$$;

-- Creates (idempotently, by key hash) a profile for a device that saves a vehicle before
-- its first booking.
create or replace function public.api_public_profile_ensure(p_slug text, p_profile_key_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  p public.client_profiles;
begin
  t := private.public_tenant(p_slug);
  insert into public.client_profiles (tenant_id, key_hash, is_demo)
  values (t.id, p_profile_key_hash, t.status = 'demo')
  on conflict (key_hash) do nothing;
  p := private.profile_by_key(t.id, p_profile_key_hash);
  return jsonb_build_object('profile_id', p.id);
end;
$$;

create or replace function public.api_public_profile_update(p_slug text, p_profile_key_hash bytea, p_contact jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  p public.client_profiles;
begin
  t := private.public_tenant(p_slug);
  p := private.profile_by_key(t.id, p_profile_key_hash);
  update public.client_profiles
     set display_name = coalesce(nullif(btrim(coalesce(p_contact ->> 'name', '')), ''), display_name),
         phone_e164 = coalesce(p_contact ->> 'phone', phone_e164),
         email = case when p_contact ? 'email' then nullif(btrim(coalesce(p_contact ->> 'email', '')), '') else email end
   where id = p.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Revokes the device key ("forget this device"). Data stays for the studio.
create or replace function public.api_public_profile_revoke(p_slug text, p_profile_key_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  p public.client_profiles;
begin
  t := private.public_tenant(p_slug);
  p := private.profile_by_key(t.id, p_profile_key_hash);
  update public.client_profiles set revoked_at = now() where id = p.id;
  delete from public.push_subscriptions where tenant_id = t.id and client_profile_id = p.id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.api_public_vehicle_save(p_slug text, p_profile_key_hash bytea, p_vehicle jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  p public.client_profiles;
  v_id uuid;
begin
  t := private.public_tenant(p_slug);
  p := private.profile_by_key(t.id, p_profile_key_hash);
  if p_vehicle ? 'id' then
    update public.customer_vehicles
       set nickname = nullif(btrim(coalesce(p_vehicle ->> 'nickname', '')), ''),
           make = btrim(p_vehicle ->> 'make'), model = btrim(p_vehicle ->> 'model'),
           generation = nullif(btrim(coalesce(p_vehicle ->> 'generation', '')), ''),
           year = (p_vehicle ->> 'year')::int, body_type = p_vehicle ->> 'body_type',
           color = nullif(btrim(coalesce(p_vehicle ->> 'color', '')), ''),
           plate = nullif(upper(btrim(coalesce(p_vehicle ->> 'plate', ''))), ''),
           client_comment = coalesce(p_vehicle ->> 'comment', '')
     where tenant_id = t.id and id = (p_vehicle ->> 'id')::uuid and client_profile_id = p.id and archived_at is null
    returning id into v_id;
    if v_id is null then
      perform private.fail('VEHICLE_NOT_FOUND', 'Автомобиль не найден в гараже');
    end if;
  else
    v_id := private.insert_vehicle(t.id, p.customer_id, p.id, p_vehicle, t.status = 'demo');
  end if;
  return jsonb_build_object('vehicle_id', v_id);
end;
$$;

create or replace function public.api_public_vehicle_archive(p_slug text, p_profile_key_hash bytea, p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  p public.client_profiles;
begin
  t := private.public_tenant(p_slug);
  p := private.profile_by_key(t.id, p_profile_key_hash);
  update public.customer_vehicles set archived_at = now()
   where tenant_id = t.id and id = p_vehicle_id and client_profile_id = p.id and archived_at is null;
  if not found then
    perform private.fail('VEHICLE_NOT_FOUND', 'Автомобиль не найден в гараже');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Registers an uploaded vehicle photo (the Edge Function stored the object).
create or replace function public.api_public_vehicle_photo(
  p_slug text, p_profile_key_hash bytea, p_vehicle_id uuid, p_path text, p_width int, p_height int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  p public.client_profiles;
  v_media uuid;
begin
  t := private.public_tenant(p_slug);
  p := private.profile_by_key(t.id, p_profile_key_hash);
  perform 1 from public.customer_vehicles
   where tenant_id = t.id and id = p_vehicle_id and client_profile_id = p.id and archived_at is null;
  if not found then
    perform private.fail('VEHICLE_NOT_FOUND', 'Автомобиль не найден в гараже');
  end if;
  insert into public.media (tenant_id, kind, bucket, path, width, height, vehicle_id, source, client_visible)
  values (t.id, 'vehicle', 'private-media', p_path, p_width, p_height, p_vehicle_id, 'client', true)
  returning id into v_media;
  update public.customer_vehicles set photo_media_id = v_media where id = p_vehicle_id;
  return jsonb_build_object('media_id', v_media);
end;
$$;

create or replace function public.api_public_push_subscribe(
  p_slug text, p_profile_key_hash bytea, p_token_hash bytea, p_booking_id uuid, p_subscription jsonb, p_user_agent text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  p public.client_profiles;
  v_booking uuid;
begin
  t := private.public_tenant(p_slug);
  if p_profile_key_hash is not null then
    p := private.profile_by_key(t.id, p_profile_key_hash);
  else
    v_booking := private.client_booking_id(t.id, p_token_hash, null, p_booking_id);
  end if;
  insert into public.push_subscriptions (tenant_id, audience, client_profile_id, booking_id, endpoint, p256dh, auth, user_agent)
  values (t.id, 'client', p.id, v_booking, p_subscription ->> 'endpoint', p_subscription #>> '{keys,p256dh}',
          p_subscription #>> '{keys,auth}', left(p_user_agent, 300))
  on conflict (tenant_id, endpoint) do update
    set audience = 'client', user_id = null,
        client_profile_id = coalesce(excluded.client_profile_id, public.push_subscriptions.client_profile_id),
        booking_id = coalesce(excluded.booking_id, public.push_subscriptions.booking_id),
        p256dh = excluded.p256dh, auth = excluded.auth, disabled_at = null, disabled_reason = null;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.api_public_push_unsubscribe(p_slug text, p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := private.public_tenant(p_slug);
  delete from public.push_subscriptions where tenant_id = t.id and endpoint = p_endpoint and audience = 'client';
  return jsonb_build_object('ok', true);
end;
$$;

-- Atomic fixed-window rate limiter shared by every Edge Function instance.
create table private.rate_limits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, key, window_start)
);

create or replace function public.api_rate_limit_hit(p_bucket text, p_key text, p_limit int, p_window_seconds int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into private.rate_limits (bucket, key, window_start, hits)
  values (p_bucket, p_key, v_window, 1)
  on conflict (bucket, key, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;
  return jsonb_build_object('allowed', v_hits <= p_limit, 'hits', v_hits, 'limit', p_limit,
                            'reset_at', v_window + make_interval(secs => p_window_seconds));
end;
$$;
