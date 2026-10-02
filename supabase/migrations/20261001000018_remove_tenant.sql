-- Removing a studio that is no longer wanted (a demo you do not need, a test studio).
-- `pnpm tenant:remove <slug>` (and the Deploy button's "remove studio" field) calls this.
-- Guard: a studio that is or ever was live is refused, whatever it holds; a demo or draft
-- studio holds demo and test data only. Every tenant-owned row cascades from the tenant
-- (migration …012). The caller removes Storage objects first (listed by p_dry_run) and the
-- Auth accounts of members who belong to no other studio afterwards.
create or replace function public.api_admin_remove_tenant(p_slug text, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_report jsonb;
  v_objects jsonb := '[]';
begin
  select * into t from public.tenants where slug = p_slug for update;
  if not found then
    return jsonb_build_object('found', false, 'slug', p_slug);
  end if;
  if t.status = 'live' or t.live_since is not null then
    perform private.fail('LIVE_TENANT', 'Студия «' || t.name || '» работает с клиентами (live) — она не удаляется');
  end if;
  -- Storage is absent only in the bare test database (as in …010).
  if to_regclass('storage.objects') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name) order by o.name), '[]')
               from storage.objects o
               where o.bucket_id in ('public-media', 'private-media') and o.name like $1 || '/%'$q$
      into v_objects using t.id::text;
  end if;
  v_report := jsonb_build_object(
    'found', true, 'removed', not p_dry_run, 'tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status,
    'bookings', (select count(*) from public.bookings where tenant_id = t.id),
    'customers', (select count(*) from public.customers where tenant_id = t.id),
    'services', (select count(*) from public.services where tenant_id = t.id),
    'objects', v_objects,
    'orphan_users', coalesce((select jsonb_agg(m.user_id) from public.tenant_members m
                              where m.tenant_id = t.id
                                and not exists (select 1 from public.tenant_members o
                                                where o.user_id = m.user_id and o.tenant_id <> t.id)), '[]'));
  if not p_dry_run then
    delete from public.tenants where id = t.id;
  end if;
  return v_report;
end;
$$;

revoke execute on function public.api_admin_remove_tenant(text, boolean) from public, anon, authenticated;
grant execute on function public.api_admin_remove_tenant(text, boolean) to service_role;

-- Stated explicitly for the table added in …017 (private tables are never client-readable).
revoke all on private.owner_removed_config from public, anon, authenticated;
