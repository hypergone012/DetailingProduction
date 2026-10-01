-- Final privilege state, stated explicitly so it does not depend on platform defaults.
-- tests/db/grants.test.ts asserts exactly this.

-- anon: nothing.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;

-- authenticated: SELECT on tenant tables (RLS-filtered) and owner_* functions only.
revoke all on all tables in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;
revoke execute on all functions in schema public from authenticated;

grant select on
  public.tenants, public.tenant_settings, public.tenant_members,
  public.resources, public.services, public.service_variants, public.service_addons,
  public.business_hours, public.business_exceptions, public.media,
  public.customers, public.customer_vehicles,
  public.bookings, public.booking_items, public.resource_occupancies, public.booking_events, public.payments,
  public.notification_jobs, public.customer_overview
to authenticated;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
  loop
    if f.proname like 'owner\_%' then
      execute format('grant execute on function %s to authenticated', f.sig);
    elsif f.proname like 'api\_%' then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end;
$$;

-- private: internals are callable only through SECURITY DEFINER entry points, except the
-- membership helpers RLS policies evaluate as the querying user.
revoke execute on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.role_rank(text), private.my_tenant_ids(text), private.has_role(uuid, text)
  to authenticated, service_role;
revoke all on all tables in schema private from public, anon, authenticated;
