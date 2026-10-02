-- Owner deletions survive republishing. Before this, deleting a config photo or a config
-- day-off in the cabinet lasted only until the next `tenant:publish` (every Deploy run):
-- the row was gone, so publish inserted it again. Now the cabinet records what the owner
-- removed and publish leaves it out (reported under kept_owner_edits); --overwrite clears
-- the record and restores the config, exactly like it does for edited rows.

create table private.owner_removed_config (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('media', 'exception')),
  key text not null,
  removed_at timestamptz not null default now(),
  primary key (tenant_id, kind, key)
);

create or replace function public.owner_delete_exception(p_exception uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.business_exceptions;
begin
  select * into e from public.business_exceptions where id = p_exception;
  perform private.require_role(e.tenant_id, 'manager');
  delete from public.business_exceptions where id = p_exception;
  -- Keyed by day: a config exception for this day is not brought back by the next publish.
  if e.id is not null then
    insert into private.owner_removed_config (tenant_id, kind, key)
    values (e.tenant_id, 'exception', to_char(e.day, 'YYYY-MM-DD'))
    on conflict do nothing;
  end if;
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
  -- Config media (it has a key) is not brought back by the next publish.
  if m.key is not null then
    insert into private.owner_removed_config (tenant_id, kind, key)
    values (m.tenant_id, 'media', m.key::text)
    on conflict do nothing;
  end if;
  -- The caller removes the stored object only when no other row still uses it.
  return jsonb_build_object('bucket', m.bucket, 'path', m.path,
    'delete_object', not exists (select 1 from public.media x where x.bucket = m.bucket and x.path = m.path));
end;
$$;

-- p_config is the normalized config produced by `tenant:publish` (see packages/core).
-- Rules:
--   * entities are matched by stable keys (tenant id, resource/service/addon/media keys,
--     exception day), never recreated;
--   * a config-managed row is updated only if it still carries the signature of the last
--     publish; a row an owner edited (signature null) is kept unless p_overwrite;
--   * a config exception/media row the owner deleted in the cabinet is not recreated
--     unless p_overwrite (private.owner_removed_config);
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
  if p_overwrite then
    delete from private.owner_removed_config where tenant_id = v_tenant;
  end if;

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
    if v_id is null and exists (select 1 from private.owner_removed_config r where r.tenant_id = v_tenant
                                and r.kind = 'exception' and r.key = to_char((x ->> 'day')::date, 'YYYY-MM-DD')) then
      v_report := jsonb_set(v_report, '{kept_owner_edits}', (v_report -> 'kept_owner_edits') || to_jsonb('exception:' || (x ->> 'day')));
    elsif v_id is null then
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
    if v_id is null and exists (select 1 from private.owner_removed_config r where r.tenant_id = v_tenant
                                and r.kind = 'media' and r.key = m ->> 'key') then
      v_report := jsonb_set(v_report, '{kept_owner_edits}', (v_report -> 'kept_owner_edits') || to_jsonb('media:' || (m ->> 'key')));
    elsif v_id is null then
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
