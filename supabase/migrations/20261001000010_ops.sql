-- Operations: notification dispatch, AI budget, tenant publishing, demo seed, storage,
-- scheduled jobs. All `api_*` functions are service-role only (see the grants migration).

---------------------------------------------------------------------------------------
-- Notification dispatch
---------------------------------------------------------------------------------------

-- Leases due jobs for one worker and returns them with their delivery targets. Jobs that
-- must not be delivered any more (tenant no longer live, demo record, stale reminder, no
-- subscriptions) are finalized here and not returned.
create or replace function public.api_notifications_lease(p_worker text, p_limit int, p_lease_seconds int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.notification_jobs;
  b public.bookings;
  v_out jsonb := '[]';
  v_targets jsonb;
  v_reason text;
  v_tenant_status text;
  v_scanned int;
  v_rounds int := 0;
begin
  -- Jobs that turn out to be undeliverable (demo, stale, no subscriptions) are settled here and
  -- not returned. Keep scanning until something deliverable is found or the queue is empty, so a
  -- batch made only of such jobs never looks like "nothing left" to the dispatcher. Every round
  -- moves the rows it scanned out of the pending state; the round cap bounds one transaction.
  <<scan>>
  loop
  v_rounds := v_rounds + 1;
  v_scanned := 0;
  for j in
    update public.notification_jobs n
       set status = 'leased', lease_owner = p_worker, attempts = n.attempts + 1,
           lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 10)), updated_at = now()
     where n.id in (
       select id from public.notification_jobs
       where (status = 'pending' and next_attempt_at <= now())
          or (status = 'leased' and lease_expires_at < now())
       order by next_attempt_at
       limit least(greatest(p_limit, 1), 100)
       for update skip locked)
    returning n.*
  loop
    v_scanned := v_scanned + 1;
    v_reason := null;
    select status into v_tenant_status from public.tenants where id = j.tenant_id;
    select * into b from public.bookings where tenant_id = j.tenant_id and id = j.booking_id;
    if v_tenant_status is distinct from 'live' then
      v_reason := 'tenant_not_live';
    elsif b.is_demo then
      v_reason := 'demo_record';
    elsif j.event = 'booking.reminder'
      and (b.id is null or b.status not in ('pending', 'confirmed')
           or extract(epoch from b.starts_at)::bigint <> extract(epoch from (j.payload ->> 'starts_at')::timestamptz)::bigint) then
      v_reason := 'stale';
    end if;

    if v_reason is null then
      select coalesce(jsonb_agg(jsonb_build_object('subscription_id', s.id, 'endpoint', s.endpoint,
                                                   'p256dh', s.p256dh, 'auth', s.auth)), '[]')
        into v_targets
      from public.push_subscriptions s
      where s.tenant_id = j.tenant_id and s.disabled_at is null
        and ((j.audience = 'owner' and s.audience = 'owner'
              and exists (select 1 from public.tenant_members m where m.tenant_id = j.tenant_id and m.user_id = s.user_id
                            and m.role in ('owner', 'manager')))
          or (j.audience = 'client' and s.audience = 'client'
              and (s.booking_id = j.booking_id or (b.client_profile_id is not null and s.client_profile_id = b.client_profile_id))))
        and not exists (select 1 from public.notification_deliveries d where d.job_id = j.id and d.subscription_id = s.id);
      if jsonb_array_length(v_targets) = 0 then
        v_reason := case when exists (select 1 from public.notification_deliveries d where d.job_id = j.id)
                         then null else 'no_subscriptions' end;
        if v_reason is null then
          update public.notification_jobs set status = 'sent', sent_at = now(), lease_owner = null, lease_expires_at = null
           where id = j.id;
          continue;
        end if;
      end if;
    end if;

    if v_reason is not null then
      update public.notification_jobs
         set status = 'suppressed', suppressed_reason = v_reason, lease_owner = null, lease_expires_at = null
       where id = j.id;
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      'job', jsonb_build_object('id', j.id, 'tenant_id', j.tenant_id, 'event', j.event, 'audience', j.audience,
                                'attempts', j.attempts, 'payload', j.payload),
      'booking', private.booking_json(j.booking_id, j.audience = 'client'),
      'tenant', (select jsonb_build_object('name', t.name, 'slug', t.slug, 'timezone', t.timezone, 'locale', t.locale)
                 from public.tenants t where t.id = j.tenant_id),
      'targets', v_targets);
  end loop;
  exit scan when jsonb_array_length(v_out) > 0 or v_scanned = 0 or v_rounds >= 20;
  end loop scan;
  return v_out;
end;
$$;

-- results: [{subscription_id, status: 'sent'|'gone'|'failed', http_status?, error?}]
-- Only the current lease holder may report. Returns {accepted, status}.
create or replace function public.api_notifications_report(p_job uuid, p_worker text, p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.notification_jobs;
  r jsonb;
  v_failed int := 0;
  v_status text;
begin
  select * into j from public.notification_jobs where id = p_job for update;
  if not found or j.status <> 'leased' or j.lease_owner is distinct from p_worker then
    return jsonb_build_object('accepted', false);
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]')) loop
    insert into public.notification_deliveries (job_id, subscription_id, tenant_id, status, http_status, error)
    values (j.id, (r ->> 'subscription_id')::uuid, j.tenant_id, r ->> 'status', (r ->> 'http_status')::int, left(r ->> 'error', 300))
    on conflict (job_id, subscription_id) do nothing;
    if r ->> 'status' = 'gone' then
      update public.push_subscriptions set disabled_at = now(), disabled_reason = 'gone'
       where id = (r ->> 'subscription_id')::uuid and tenant_id = j.tenant_id;
    elsif r ->> 'status' = 'sent' then
      update public.push_subscriptions set last_success_at = now()
       where id = (r ->> 'subscription_id')::uuid and tenant_id = j.tenant_id;
    else
      v_failed := v_failed + 1;
      -- a failed delivery must be retried: forget it so the next lease targets it again
      delete from public.notification_deliveries where job_id = j.id and subscription_id = (r ->> 'subscription_id')::uuid;
    end if;
  end loop;

  if v_failed = 0 then
    v_status := 'sent';
    update public.notification_jobs
       set status = 'sent', sent_at = now(), lease_owner = null, lease_expires_at = null, last_error = null
     where id = j.id;
  elsif j.attempts >= j.max_attempts then
    v_status := 'dead';
    update public.notification_jobs
       set status = 'dead', lease_owner = null, lease_expires_at = null,
           last_error = left(coalesce((select string_agg(x ->> 'error', '; ') from jsonb_array_elements(p_results) x
                                       where x ->> 'status' = 'failed'), 'delivery failed'), 500)
     where id = j.id;
  else
    v_status := 'pending';
    update public.notification_jobs
       set status = 'pending', lease_owner = null, lease_expires_at = null,
           next_attempt_at = now() + make_interval(secs => 30 * power(2, j.attempts)::int),
           last_error = left(coalesce((select string_agg(x ->> 'error', '; ') from jsonb_array_elements(p_results) x
                                       where x ->> 'status' = 'failed'), 'delivery failed'), 500)
     where id = j.id;
  end if;
  return jsonb_build_object('accepted', true, 'status', v_status);
end;
$$;

---------------------------------------------------------------------------------------
-- AI budget (atomic counters per tenant-local day)
---------------------------------------------------------------------------------------

create table private.ai_usage (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  day date not null,
  scope text not null check (scope in ('client', 'owner')),
  requests int not null default 0,
  tokens int not null default 0,
  primary key (tenant_id, day, scope)
);

-- Reserves one AI request against the tenant's daily request limit and token budget.
create or replace function public.api_ai_reserve(p_tenant uuid, p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date;
  v_req_limit int;
  v_tok_limit int;
  v_features jsonb;
  v_requests int;
begin
  select (now() at time zone t.timezone)::date, s.ai_daily_request_limit, s.ai_daily_token_budget, s.features
    into v_day, v_req_limit, v_tok_limit, v_features
  from public.tenants t join public.tenant_settings s on s.tenant_id = t.id
  where t.id = p_tenant;
  if v_day is null then
    return jsonb_build_object('allowed', false, 'reason', 'tenant_not_found');
  end if;
  if coalesce((v_features ->> 'ai')::boolean, true) = false then
    return jsonb_build_object('allowed', false, 'reason', 'disabled');
  end if;
  insert into private.ai_usage (tenant_id, day, scope) values (p_tenant, v_day, p_scope) on conflict do nothing;
  update private.ai_usage u
     set requests = u.requests + 1
   where u.tenant_id = p_tenant and u.day = v_day and u.scope = p_scope
     and (select coalesce(sum(requests), 0) from private.ai_usage x where x.tenant_id = p_tenant and x.day = v_day) < v_req_limit
     and (select coalesce(sum(tokens), 0) from private.ai_usage x where x.tenant_id = p_tenant and x.day = v_day) < v_tok_limit
  returning u.requests into v_requests;
  if v_requests is null then
    return jsonb_build_object('allowed', false, 'reason', 'budget_exhausted');
  end if;
  return jsonb_build_object('allowed', true, 'requests_today', v_requests);
end;
$$;

create or replace function public.api_ai_record_tokens(p_tenant uuid, p_scope text, p_tokens int)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.ai_usage u set tokens = u.tokens + greatest(p_tokens, 0)
  where u.tenant_id = p_tenant and u.scope = p_scope
    and u.day = (select (now() at time zone t.timezone)::date from public.tenants t where t.id = p_tenant)
$$;

---------------------------------------------------------------------------------------
-- Tenant publishing (config -> runtime DB), idempotent and non-destructive
---------------------------------------------------------------------------------------

create table private.tenant_publications (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  config_hash text not null,
  report jsonb not null,
  published_at timestamptz not null default now()
);

create or replace function private.sig(p jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(p::text)
$$;

-- p_config is the normalized config produced by `tenant:publish` (see packages/core).
-- Rules:
--   * entities are matched by stable keys (tenant id, resource/service/addon/media keys,
--     exception day), never recreated;
--   * a config-managed row is updated only if it still carries the signature of the last
--     publish; a row an owner edited (signature null) is kept unless p_overwrite;
--   * nothing is deleted except config-owned exceptions/media that left the config;
--     services/resources that left the config are deactivated (bookings reference them);
--   * bookings, customers, vehicles, payments, owner media are never touched.
create or replace function public.api_admin_publish_tenant(p_config jsonb, p_config_hash text, p_overwrite boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (p_config ->> 'id')::uuid;
  t public.tenants;
  v_created boolean := false;
  v_sig text;
  v_report jsonb := jsonb_build_object('created', '[]'::jsonb, 'updated', '[]'::jsonb, 'kept_owner_edits', '[]'::jsonb,
                                       'deactivated', '[]'::jsonb, 'deleted', '[]'::jsonb, 'unchanged', 0);
  s jsonb;
  a jsonb;
  m jsonb;
  x jsonb;
  v_row_sig text;
  v_id uuid;
  v_service uuid;
  v_status text := p_config ->> 'status';
  v_settings jsonb := p_config -> 'settings';
  v_keys text[];
begin
  -- Tenant row
  v_sig := private.sig(jsonb_build_object('name', p_config ->> 'name', 'slug', p_config ->> 'slug',
    'timezone', p_config ->> 'timezone', 'locale', p_config ->> 'locale', 'currency', p_config ->> 'currency'));
  select * into t from public.tenants where id = v_tenant for update;
  if not found then
    insert into public.tenants (id, slug, name, status, timezone, locale, currency, config_sig)
    values (v_tenant, p_config ->> 'slug', p_config ->> 'name', 'draft', p_config ->> 'timezone',
            p_config ->> 'locale', p_config ->> 'currency', v_sig)
    returning * into t;
    insert into public.tenant_settings (tenant_id) values (v_tenant);
    v_created := true;
    v_report := jsonb_set(v_report, '{created}', (v_report -> 'created') || '"tenant"');
  elsif t.config_sig is distinct from v_sig then
    if t.config_sig is null and not p_overwrite then
      v_report := jsonb_set(v_report, '{kept_owner_edits}', (v_report -> 'kept_owner_edits') || '"tenant"');
    else
      update public.tenants set slug = p_config ->> 'slug', name = p_config ->> 'name', timezone = p_config ->> 'timezone',
        locale = p_config ->> 'locale', currency = p_config ->> 'currency', config_sig = v_sig
      where id = v_tenant;
      v_report := jsonb_set(v_report, '{updated}', (v_report -> 'updated') || '"tenant"');
    end if;
  else
    v_report := jsonb_set(v_report, '{unchanged}', to_jsonb((v_report ->> 'unchanged')::int + 1));
  end if;

  -- Settings
  v_sig := private.sig(v_settings);
  select config_sig into v_row_sig from public.tenant_settings where tenant_id = v_tenant;
  if v_created or (v_row_sig is distinct from v_sig and (v_row_sig is not null or p_overwrite)) then
    update public.tenant_settings set
      tagline = coalesce(v_settings ->> 'tagline', ''), description = coalesce(v_settings ->> 'description', ''),
      address = coalesce(v_settings ->> 'address', ''), map_url = v_settings ->> 'map_url',
      phone = v_settings ->> 'phone', email = v_settings ->> 'email', website = v_settings ->> 'website',
      socials = coalesce(v_settings -> 'socials', '[]'), branding = coalesce(v_settings -> 'branding', '{}'),
      seo = coalesce(v_settings -> 'seo', '{}'), features = coalesce(v_settings -> 'features', '{}'),
      slot_step_min = (v_settings #>> '{policy,slot_step_min}')::int,
      min_notice_min = (v_settings #>> '{policy,min_notice_min}')::int,
      horizon_days = (v_settings #>> '{policy,horizon_days}')::int,
      cancel_cutoff_hours = (v_settings #>> '{policy,cancel_cutoff_hours}')::int,
      requires_confirmation = (v_settings #>> '{policy,requires_confirmation}')::boolean,
      max_active_bookings_per_phone = (v_settings #>> '{policy,max_active_bookings_per_phone}')::int,
      reminder_hours_before = (v_settings #>> '{notifications,reminder_hours_before}')::int,
      notify_owner_push = (v_settings #>> '{notifications,owner_push}')::boolean,
      notify_client_push = (v_settings #>> '{notifications,client_push}')::boolean,
      ai_daily_request_limit = (v_settings #>> '{ai,daily_request_limit}')::int,
      ai_daily_token_budget = (v_settings #>> '{ai,daily_token_budget}')::int,
      config_sig = v_sig
    where tenant_id = v_tenant;
    if not v_created then
      v_report := jsonb_set(v_report, '{updated}', (v_report -> 'updated') || '"settings"');
    end if;
  elsif v_row_sig is null and v_row_sig is distinct from v_sig then
    v_report := jsonb_set(v_report, '{kept_owner_edits}', (v_report -> 'kept_owner_edits') || '"settings"');
  else
    v_report := jsonb_set(v_report, '{unchanged}', to_jsonb((v_report ->> 'unchanged')::int + 1));
  end if;

  -- Weekly hours (one signature for the whole schedule)
  v_sig := private.sig(p_config -> 'hours');
  select hours_config_sig into v_row_sig from public.tenant_settings where tenant_id = v_tenant;
  if v_created or (v_row_sig is distinct from v_sig and (v_row_sig is not null or p_overwrite)) then
    perform private.replace_hours(v_tenant, p_config -> 'hours');
    update public.tenant_settings set hours_config_sig = v_sig where tenant_id = v_tenant;
    if not v_created then
      v_report := jsonb_set(v_report, '{updated}', (v_report -> 'updated') || '"hours"');
    end if;
  elsif v_row_sig is null then
    v_report := jsonb_set(v_report, '{kept_owner_edits}', (v_report -> 'kept_owner_edits') || '"hours"');
  end if;

  -- Exceptions (by day)
  for x in select * from jsonb_array_elements(coalesce(p_config -> 'exceptions', '[]')) loop
    v_sig := private.sig(x);
    select config_sig, id into v_row_sig, v_id from public.business_exceptions
     where tenant_id = v_tenant and day = (x ->> 'day')::date;
    if v_id is null then
      insert into public.business_exceptions (tenant_id, day, closed, opens, closes, note, config_sig)
      values (v_tenant, (x ->> 'day')::date, (x ->> 'closed')::boolean, (x ->> 'opens')::time, (x ->> 'closes')::time,
              coalesce(x ->> 'note', ''), v_sig);
      v_report := jsonb_set(v_report, '{created}', (v_report -> 'created') || to_jsonb('exception:' || (x ->> 'day')));
    elsif v_row_sig is distinct from v_sig then
      if v_row_sig is null and not p_overwrite then
        v_report := jsonb_set(v_report, '{kept_owner_edits}', (v_report -> 'kept_owner_edits') || to_jsonb('exception:' || (x ->> 'day')));
      else
        update public.business_exceptions set closed = (x ->> 'closed')::boolean, opens = (x ->> 'opens')::time,
          closes = (x ->> 'closes')::time, note = coalesce(x ->> 'note', ''), config_sig = v_sig where id = v_id;
        v_report := jsonb_set(v_report, '{updated}', (v_report -> 'updated') || to_jsonb('exception:' || (x ->> 'day')));
      end if;
    end if;
    v_id := null;
  end loop;
  with gone as (
    delete from public.business_exceptions e
    where e.tenant_id = v_tenant and e.config_sig is not null
      and e.day not in (select (e ->> 'day')::date from jsonb_array_elements(coalesce(p_config -> 'exceptions', '[]')) e)
    returning e.day)
  select v_report || jsonb_build_object('deleted', (v_report -> 'deleted') ||
           coalesce((select jsonb_agg('exception:' || day) from gone), '[]'))
    into v_report;

  -- Resources
  for x in select * from jsonb_array_elements(coalesce(p_config -> 'resources', '[]')) loop
    v_sig := private.sig(x);
    select config_sig, id into v_row_sig, v_id from public.resources where tenant_id = v_tenant and key = x ->> 'key';
    if v_id is null then
      insert into public.resources (tenant_id, key, name, type, sort_order, config_sig)
      values (v_tenant, x ->> 'key', x ->> 'name', x ->> 'type', coalesce((x ->> 'sort_order')::int, 0), v_sig);
      v_report := jsonb_set(v_report, '{created}', (v_report -> 'created') || to_jsonb('resource:' || (x ->> 'key')));
    elsif v_row_sig is distinct from v_sig then
      if v_row_sig is null and not p_overwrite then
        v_report := jsonb_set(v_report, '{kept_owner_edits}', (v_report -> 'kept_owner_edits') || to_jsonb('resource:' || (x ->> 'key')));
      else
        update public.resources set name = x ->> 'name', type = x ->> 'type', active = true,
          sort_order = coalesce((x ->> 'sort_order')::int, 0), config_sig = v_sig where id = v_id;
        v_report := jsonb_set(v_report, '{updated}', (v_report -> 'updated') || to_jsonb('resource:' || (x ->> 'key')));
      end if;
    end if;
    v_id := null;
  end loop;
  select coalesce(array_agg(e ->> 'key'), '{}') into v_keys from jsonb_array_elements(coalesce(p_config -> 'resources', '[]')) e;
  with gone as (
    update public.resources r set active = false
    where r.tenant_id = v_tenant and r.active and r.config_sig is not null and not (r.key::text = any (v_keys))
    returning r.key)
  select v_report || jsonb_build_object('deactivated', (v_report -> 'deactivated') ||
           coalesce((select jsonb_agg('resource:' || key) from gone), '[]'))
    into v_report;

  -- Services (+ variants and add-ons under the service signature)
  for s in select * from jsonb_array_elements(coalesce(p_config -> 'services', '[]')) loop
    v_sig := private.sig(s);
    select config_sig, id into v_row_sig, v_service from public.services where tenant_id = v_tenant and key = s ->> 'key';
    if v_service is null or v_row_sig is distinct from v_sig and (v_row_sig is not null or p_overwrite) then
      if v_service is null then
        insert into public.services (tenant_id, key, name, duration_min, price_cents, resource_types)
        values (v_tenant, s ->> 'key', s ->> 'name', (s ->> 'duration_min')::int, (s ->> 'price_cents')::bigint,
                (select array_agg(y) from jsonb_array_elements_text(s -> 'resource_types') y))
        returning id into v_service;
        v_report := jsonb_set(v_report, '{created}', (v_report -> 'created') || to_jsonb('service:' || (s ->> 'key')));
      else
        v_report := jsonb_set(v_report, '{updated}', (v_report -> 'updated') || to_jsonb('service:' || (s ->> 'key')));
      end if;
      update public.services set
        name = s ->> 'name', category = coalesce(s ->> 'category', 'other'), summary = coalesce(s ->> 'summary', ''),
        description = coalesce(s ->> 'description', ''), duration_min = (s ->> 'duration_min')::int,
        buffer_before_min = coalesce((s ->> 'buffer_before_min')::int, 0),
        buffer_after_min = coalesce((s ->> 'buffer_after_min')::int, 0),
        price_cents = (s ->> 'price_cents')::bigint,
        resource_types = (select array_agg(y) from jsonb_array_elements_text(s -> 'resource_types') y),
        multi_day = coalesce((s ->> 'multi_day')::boolean, false),
        requires_confirmation = coalesce((s ->> 'requires_confirmation')::boolean, false),
        allowed_body_types = (select array_agg(y) from jsonb_array_elements_text(nullif(s -> 'allowed_body_types', 'null'::jsonb)) y),
        benefits = coalesce((select array_agg(y) from jsonb_array_elements_text(s -> 'benefits') y), '{}'),
        prep_notes = coalesce((select array_agg(y) from jsonb_array_elements_text(s -> 'prep_notes') y), '{}'),
        restrictions = coalesce((select array_agg(y) from jsonb_array_elements_text(s -> 'restrictions') y), '{}'),
        recommended_keys = coalesce((select array_agg(y) from jsonb_array_elements_text(s -> 'recommended_keys') y), '{}'),
        repeat_interval_days = (s ->> 'repeat_interval_days')::int,
        bookable_online = coalesce((s ->> 'bookable_online')::boolean, true),
        active = true, sort_order = coalesce((s ->> 'sort_order')::int, 0), config_sig = v_sig
      where id = v_service;
      delete from public.service_variants where service_id = v_service;
      insert into public.service_variants (tenant_id, service_id, body_type, price_cents, duration_min)
      select v_tenant, v_service, y ->> 'body_type', (y ->> 'price_cents')::bigint, (y ->> 'duration_min')::int
      from jsonb_array_elements(coalesce(s -> 'variants', '[]')) y;
      for a in select * from jsonb_array_elements(coalesce(s -> 'addons', '[]')) loop
        insert into public.service_addons (tenant_id, service_id, key, name, description, price_cents, duration_min, sort_order, config_sig)
        values (v_tenant, v_service, a ->> 'key', a ->> 'name', coalesce(a ->> 'description', ''), (a ->> 'price_cents')::bigint,
                coalesce((a ->> 'duration_min')::int, 0), coalesce((a ->> 'sort_order')::int, 0), private.sig(a))
        on conflict (tenant_id, service_id, key) do update
          set name = excluded.name, description = excluded.description, price_cents = excluded.price_cents,
              duration_min = excluded.duration_min, sort_order = excluded.sort_order, active = true, config_sig = excluded.config_sig;
      end loop;
      update public.service_addons set active = false
       where tenant_id = v_tenant and service_id = v_service and config_sig is not null
         and not (key::text = any (select y ->> 'key' from jsonb_array_elements(coalesce(s -> 'addons', '[]')) y));
    elsif v_row_sig is null and v_row_sig is distinct from v_sig then
      v_report := jsonb_set(v_report, '{kept_owner_edits}', (v_report -> 'kept_owner_edits') || to_jsonb('service:' || (s ->> 'key')));
    else
      v_report := jsonb_set(v_report, '{unchanged}', to_jsonb((v_report ->> 'unchanged')::int + 1));
    end if;
    v_service := null;
  end loop;
  select coalesce(array_agg(e ->> 'key'), '{}') into v_keys from jsonb_array_elements(coalesce(p_config -> 'services', '[]')) e;
  with gone as (
    update public.services sv set active = false
    where sv.tenant_id = v_tenant and sv.active and sv.config_sig is not null and not (sv.key::text = any (v_keys))
    returning sv.key)
  select v_report || jsonb_build_object('deactivated', (v_report -> 'deactivated') ||
           coalesce((select jsonb_agg('service:' || key) from gone), '[]'))
    into v_report;

  -- Config media (by key). Owner-uploaded media has no key and is never touched.
  for m in select * from jsonb_array_elements(coalesce(p_config -> 'media', '[]')) loop
    v_sig := private.sig(m);
    select config_sig, id into v_row_sig, v_id from public.media where tenant_id = v_tenant and key = m ->> 'key';
    if v_id is null then
      insert into public.media (tenant_id, key, kind, bucket, path, variants, width, height, alt, caption, service_id,
                                source, sort_order, config_sig)
      values (v_tenant, m ->> 'key', m ->> 'kind', 'public-media', m ->> 'path', coalesce(m -> 'variants', '[]'),
              (m ->> 'width')::int, (m ->> 'height')::int, coalesce(m ->> 'alt', ''), coalesce(m ->> 'caption', ''),
              (select id from public.services where tenant_id = v_tenant and key = m ->> 'service_key'),
              'config', coalesce((m ->> 'sort_order')::int, 0), v_sig);
      v_report := jsonb_set(v_report, '{created}', (v_report -> 'created') || to_jsonb('media:' || (m ->> 'key')));
    elsif v_row_sig is distinct from v_sig then
      if v_row_sig is null and not p_overwrite then
        v_report := jsonb_set(v_report, '{kept_owner_edits}', (v_report -> 'kept_owner_edits') || to_jsonb('media:' || (m ->> 'key')));
      else
        update public.media set kind = m ->> 'kind', path = m ->> 'path', variants = coalesce(m -> 'variants', '[]'),
          width = (m ->> 'width')::int, height = (m ->> 'height')::int, alt = coalesce(m ->> 'alt', ''),
          caption = coalesce(m ->> 'caption', ''),
          service_id = (select id from public.services where tenant_id = v_tenant and key = m ->> 'service_key'),
          sort_order = coalesce((m ->> 'sort_order')::int, 0), config_sig = v_sig
        where id = v_id;
        v_report := jsonb_set(v_report, '{updated}', (v_report -> 'updated') || to_jsonb('media:' || (m ->> 'key')));
      end if;
    end if;
    v_id := null;
  end loop;
  select coalesce(array_agg(e ->> 'key'), '{}') into v_keys from jsonb_array_elements(coalesce(p_config -> 'media', '[]')) e;
  with gone as (
    delete from public.media md
    where md.tenant_id = v_tenant and md.source = 'config' and md.config_sig is not null and not (md.key::text = any (v_keys))
    returning md.key)
  select v_report || jsonb_build_object('deleted', (v_report -> 'deleted') ||
           coalesce((select jsonb_agg('media:' || key) from gone), '[]'))
    into v_report;

  -- Members (never removed by publishing)
  for x in select * from jsonb_array_elements(coalesce(p_config -> 'members', '[]')) loop
    insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, (x ->> 'user_id')::uuid, x ->> 'role')
    on conflict (tenant_id, user_id) do nothing;
  end loop;

  -- Status: set on creation; afterwards only draft -> demo/live and demo -> live, never a
  -- downgrade (the owner controls live/demo in the cabinet).
  select * into t from public.tenants where id = v_tenant;
  if v_status is not null and v_status <> t.status
     and ((t.status = 'draft' and v_status in ('demo', 'live')) or (t.status = 'demo' and v_status = 'live')) then
    if v_status = 'live' and not (private.live_readiness(v_tenant) ->> 'ready')::boolean then
      perform private.fail('NOT_READY', 'Студия не готова к live: ' || (private.live_readiness(v_tenant) -> 'checks')::text);
    end if;
    update public.tenants set status = v_status, live_since = case when v_status = 'live' then now() end where id = v_tenant;
    v_report := jsonb_set(v_report, '{updated}', (v_report -> 'updated') || to_jsonb('status:' || v_status));
  end if;

  insert into private.tenant_publications (tenant_id, config_hash, report) values (v_tenant, p_config_hash, v_report);
  return v_report || jsonb_build_object('tenant_id', v_tenant, 'slug', p_config ->> 'slug',
                                         'status', (select status from public.tenants where id = v_tenant));
end;
$$;

-- Demo history for a demo studio: past completed visits, upcoming bookings, payments.
-- Idempotent: does nothing if the studio already has demo bookings, unless p_reset, which
-- removes demo-flagged rows only and is refused for live studios.
-- p_seed: {customers: [{name, phone, vehicles: [{make, model, body_type, ...}],
--   visits: [{service_key, days_from_now, local_time, status, paid_method?, client_note?}]}]}
create or replace function public.api_admin_seed_demo(p_tenant uuid, p_seed jsonb, p_reset boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  c jsonb;
  v jsonb;
  visit jsonb;
  v_customer uuid;
  v_vehicle uuid;
  v_vehicles uuid[];
  v_body text;
  v_plan private.service_plan;
  v_start timestamptz;
  v_end timestamptz;
  v_resource uuid;
  v_booking uuid;
  v_created int := 0;
  v_status text;
  v_i int;
begin
  select * into t from public.tenants where id = p_tenant for update;
  if not found then
    perform private.fail('TENANT_NOT_FOUND', 'tenant not found');
  end if;
  if t.status = 'live' then
    perform private.fail('LIVE_TENANT', 'Demo data is never written to a live studio');
  end if;
  if p_reset then
    delete from public.payments where tenant_id = p_tenant and is_demo;
    delete from public.notification_jobs where tenant_id = p_tenant
      and booking_id in (select id from public.bookings where tenant_id = p_tenant and is_demo);
    delete from public.resource_occupancies where tenant_id = p_tenant
      and booking_id in (select id from public.bookings where tenant_id = p_tenant and is_demo);
    delete from public.bookings where tenant_id = p_tenant and is_demo;
    delete from public.customer_vehicles where tenant_id = p_tenant and is_demo and client_profile_id is null;
    delete from public.customers c2 where c2.tenant_id = p_tenant and c2.is_demo
      and not exists (select 1 from public.bookings b where b.tenant_id = p_tenant and b.customer_id = c2.id)
      and not exists (select 1 from public.customer_vehicles cv where cv.tenant_id = p_tenant and cv.customer_id = c2.id);
  elsif exists (select 1 from public.bookings where tenant_id = p_tenant and is_demo) then
    return jsonb_build_object('seeded', 0, 'skipped', 'already_seeded');
  end if;

  for c in select * from jsonb_array_elements(coalesce(p_seed -> 'customers', '[]')) loop
    v_customer := private.upsert_customer(p_tenant, c ->> 'name', c ->> 'phone', c ->> 'email', true);
    update public.customers set is_demo = true where id = v_customer;
    v_vehicles := '{}';
    for v in select * from jsonb_array_elements(coalesce(c -> 'vehicles', '[]')) loop
      v_vehicles := v_vehicles || private.insert_vehicle(p_tenant, v_customer, null, v, true);
    end loop;
    for visit in select * from jsonb_array_elements(coalesce(c -> 'visits', '[]')) loop
      v_vehicle := v_vehicles[coalesce((visit ->> 'vehicle_index')::int, 0) + 1];
      select body_type into v_body from public.customer_vehicles where id = v_vehicle;
      v_plan := private.plan_service(p_tenant,
        (select id from public.services where tenant_id = p_tenant and key = visit ->> 'service_key'), v_body, '{}', false);
      v_start := (((now() at time zone t.timezone)::date + (visit ->> 'days_from_now')::int) + (visit ->> 'local_time')::time)
                 at time zone t.timezone;
      v_status := coalesce(visit ->> 'status', 'completed');
      if v_start > now() then
        begin
          v_booking := private.place_booking(p_tenant, v_plan, v_start, 'owner', false, v_customer, v_vehicle, null,
                                             visit ->> 'note', null, null, 'confirmed', null, true);
        exception when others then
          continue; -- demo slot no longer fits the schedule: skip it, never fail the seed
        end;
      else
        -- Past visits are history: written directly with their occupancy, outside the
        -- "no bookings in the past" rule that protects live booking.
        v_end := private.compute_end(private.working_windows(p_tenant, (v_start at time zone t.timezone)::date - 1,
                                     (v_start at time zone t.timezone)::date + 32), v_start, v_plan.work_minutes, v_plan.multi_day);
        if v_end is null then
          continue;
        end if;
        v_booking := null;
        for v_resource in select * from private.candidate_resources(p_tenant, v_plan.resource_types, '{}') loop
          begin
            insert into public.bookings (tenant_id, code, customer_id, vehicle_id, service_id, resource_id, status, starts_at,
              ends_at, service_name, body_type, work_minutes, buffer_before_min, buffer_after_min, multi_day, price_cents,
              currency, source, is_demo, confirmed_at, completed_at, cancelled_at, cancelled_by, client_note, created_at)
            values (p_tenant, private.random_code(6), v_customer, v_vehicle, v_plan.service_id, v_resource, v_status, v_start,
              v_end, v_plan.service_name, v_plan.body_type, v_plan.work_minutes, v_plan.buffer_before_min,
              v_plan.buffer_after_min, v_plan.multi_day, v_plan.price_cents, t.currency, 'owner', true, v_start,
              case when v_status = 'completed' then v_end end,
              case when v_status = 'cancelled' then v_start - interval '2 days' end,
              case when v_status = 'cancelled' then 'client' end,
              coalesce(visit ->> 'client_note', ''), v_start - interval '7 days')
            returning id into v_booking;
            if v_status in ('completed', 'no_show') or v_status = 'confirmed' then
              insert into public.resource_occupancies (tenant_id, resource_id, kind, booking_id, during, released_at, release_reason)
              values (p_tenant, v_resource, 'booking', v_booking,
                      tstzrange(v_start - make_interval(mins => v_plan.buffer_before_min),
                                v_end + make_interval(mins => v_plan.buffer_after_min), '[)'),
                      case when v_status = 'no_show' then now() end, case when v_status = 'no_show' then 'no_show' end);
            end if;
            exit;
          exception when exclusion_violation then
            v_booking := null;
          end;
        end loop;
        if v_booking is null then
          continue;
        end if;
        v_i := 0;
        for v in select * from jsonb_array_elements(v_plan.items) loop
          insert into public.booking_items (tenant_id, booking_id, kind, ref_id, name, price_cents, minutes, sort_order)
          values (p_tenant, v_booking, v ->> 'kind', (v ->> 'ref_id')::uuid, v ->> 'name', (v ->> 'price_cents')::bigint,
                  (v ->> 'minutes')::int, v_i);
          v_i := v_i + 1;
        end loop;
        insert into public.booking_events (tenant_id, booking_id, event, data, actor)
        values (p_tenant, v_booking, 'created', jsonb_build_object('seed', true), 'system');
        if visit ? 'paid_method' and v_status = 'completed' then
          insert into public.payments (tenant_id, booking_id, customer_id, kind, method, amount_cents, currency, paid_at, is_demo)
          values (p_tenant, v_booking, v_customer, 'payment', visit ->> 'paid_method', v_plan.price_cents, t.currency, v_end, true);
        end if;
      end if;
      v_created := v_created + 1;
    end loop;
  end loop;
  return jsonb_build_object('seeded', v_created);
end;
$$;

create or replace function public.api_admin_tenant_summary(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status,
    'services', (select count(*) from public.services s where s.tenant_id = t.id and s.active),
    'resources', (select count(*) from public.resources r where r.tenant_id = t.id and r.active),
    'bookings', (select count(*) from public.bookings b where b.tenant_id = t.id),
    'customers', (select count(*) from public.customers c where c.tenant_id = t.id),
    'payments', (select count(*) from public.payments p where p.tenant_id = t.id),
    'members', (select count(*) from public.tenant_members m where m.tenant_id = t.id),
    'branding', s.branding, 'seo', s.seo, 'tagline', s.tagline,
    'media', (select coalesce(jsonb_agg(jsonb_build_object('key', m.key, 'kind', m.kind, 'bucket', m.bucket, 'path', m.path,
                                                           'variants', m.variants)), '[]')
              from public.media m where m.tenant_id = t.id and m.bucket = 'public-media'))
  from public.tenants t join public.tenant_settings s on s.tenant_id = t.id
  where t.slug = lower(p_slug)
$$;

create or replace function public.api_admin_published_tenants()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status) order by t.slug), '[]')
  from public.tenants t where t.status in ('demo', 'live')
$$;

-- Housekeeping, run by cron (or manually).
create or replace function public.api_housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rl int;
  v_idem int;
begin
  delete from private.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rl = row_count;
  delete from private.idempotency_keys where created_at < now() - interval '7 days';
  get diagnostics v_idem = row_count;
  return jsonb_build_object('rate_limits_deleted', v_rl, 'idempotency_keys_deleted', v_idem);
end;
$$;

---------------------------------------------------------------------------------------
-- Storage buckets and policies (skipped when the storage schema is absent, e.g. in the
-- plain-Postgres SQL test databases)
---------------------------------------------------------------------------------------

do $outer$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not present: buckets/policies skipped';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('public-media', 'public-media', true, 10485760, array['image/webp', 'image/jpeg', 'image/png', 'image/avif']),
         ('private-media', 'private-media', false, 10485760, array['image/webp', 'image/jpeg', 'image/png'])
  on conflict (id) do nothing;

  -- Staff upload into their own tenant folder: <tenant_id>/...
  execute $p$
    create policy media_member_insert on storage.objects for insert to authenticated
    with check (bucket_id in ('public-media', 'private-media')
                and (storage.foldername(name))[1] = any (select unnest(private.my_tenant_ids('manager'))::text))
  $p$;
  execute $p$
    create policy media_member_update on storage.objects for update to authenticated
    using (bucket_id in ('public-media', 'private-media')
           and (storage.foldername(name))[1] = any (select unnest(private.my_tenant_ids('manager'))::text))
  $p$;
  execute $p$
    create policy media_member_delete on storage.objects for delete to authenticated
    using (bucket_id in ('public-media', 'private-media')
           and (storage.foldername(name))[1] = any (select unnest(private.my_tenant_ids('manager'))::text))
  $p$;
  -- Private media is readable by the studio's staff; clients get signed URLs from the API.
  execute $p$
    create policy media_member_read on storage.objects for select to authenticated
    using (bucket_id in ('public-media', 'private-media')
           and (storage.foldername(name))[1] = any (select unnest(private.my_tenant_ids())::text))
  $p$;
end;
$outer$;

---------------------------------------------------------------------------------------
-- Scheduled jobs (Supabase Cron). Only when pg_cron and pg_net exist; the dispatcher URL and
-- secret are read from Vault (see SETUP.md, "Cron").
---------------------------------------------------------------------------------------

do $outer$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_cron/pg_net not installed: schedules not created (see SETUP.md)';
    return;
  end if;
  perform cron.schedule('notify-dispatch', '* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notify-dispatcher',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-dispatcher-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatcher_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 25000)
  $job$);
  perform cron.schedule('housekeeping', '17 3 * * *', 'select public.api_housekeeping()');
end;
$outer$;
