-- Foundation: extensions, private schema, privilege hygiene, shared helpers.
--
-- Security model (applies to every later migration):
--   * anon has no table or function privileges in `public` at all; anonymous traffic
--     goes through the `public-api` Edge Function, which calls `api_*` functions with
--     the service role.
--   * authenticated (studio staff) may SELECT tenant tables under RLS and EXECUTE
--     `owner_*` functions, which re-check membership and role. There are no INSERT/
--     UPDATE/DELETE grants: every mutation goes through a checked function.
--   * `private` is not exposed through PostgREST; it holds engine internals.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Supabase grants ALL on new objects in `public` to anon/authenticated by default.
-- Revoke those defaults for objects created by the migration role.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges revoke execute on functions from public;

-- Raise a machine-readable error. `message` is a stable code the API maps to HTTP
-- statuses; `detail` is a human-readable explanation (Russian, shown to users).
create or replace function private.fail(p_code text, p_detail text default null)
returns void
language plpgsql
volatile -- never immutable: the planner would constant-fold it inside untaken CASE branches
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, p_code);
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.is_valid_timezone(p_tz text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_tz is null or p_tz = '' then
    return false;
  end if;
  perform now() at time zone p_tz;
  return exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
exception when others then
  return false;
end;
$$;

-- Vehicle body types double as price classes for service variants.
create domain public.body_type as text
  check (value in ('hatchback', 'sedan', 'coupe', 'crossover', 'suv', 'large_suv', 'minivan', 'pickup'));

create domain public.phone_e164 as text
  check (value ~ '^\+[1-9][0-9]{7,14}$');

create domain public.money_cents as bigint
  check (value >= 0 and value <= 100000000000);

-- Stable, URL-safe key used for config-managed entities (services, resources, media...).
create domain public.entity_key as text
  check (value ~ '^[a-z0-9][a-z0-9-]{0,63}$');

-- Short human-readable booking code without ambiguous characters (0/O, 1/I/L).
create or replace function private.random_code(p_len int)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(p_len);
  v_out text := '';
begin
  for i in 0 .. p_len - 1 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  end loop;
  return v_out;
end;
$$;
