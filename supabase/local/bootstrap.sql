-- Local Supabase platform bootstrap (LOCAL DEVELOPMENT AND TESTS ONLY).
--
-- Recreates the roles, schemas and default privileges that the supabase/postgres
-- image provides before any project migration runs, so the project migrations can
-- be applied unchanged to a vanilla PostgreSQL 16 cluster. A hosted Supabase project
-- already has all of this; this file is never applied there.
--
-- The default privileges are deliberately as permissive as on the real platform
-- (anon/authenticated receive ALL on new objects in `public`). Project migrations
-- must revoke them explicitly, and tests/db/grants.test.ts asserts that they do.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'postgres';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin noinherit createrole login password 'postgres';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin noinherit createrole login password 'postgres';
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;
grant anon, authenticated, service_role to supabase_storage_admin;
alter role supabase_auth_admin set search_path = 'auth';
alter role supabase_storage_admin set search_path = 'storage';

create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
create schema if not exists storage authorization supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role;
do $$ begin execute format('grant create on database %I to supabase_auth_admin, supabase_storage_admin', current_database()); end $$;

create schema if not exists extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
