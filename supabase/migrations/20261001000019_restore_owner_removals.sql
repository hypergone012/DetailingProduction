-- One-time repair for deletions made before …017. Until then an owner's deletion of a config
-- photo or day off was not recorded, so the next publish created the row again. The publish
-- history shows it: an item whose last two events are both "created" (with no "deleted" in
-- between, i.e. it never left the config) disappeared in the meantime, and only the cabinet
-- deletes such rows. The resurrected row is deleted again and the removal recorded, unless
-- the owner has edited it since (then they evidently want it).
create or replace function private.restore_owner_removals(p_tenant uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_id uuid;
  v_done jsonb := '[]';
begin
  for r in
    with ev as (
      select p.tenant_id, p.id, x.item, 'created' as what
        from private.tenant_publications p, jsonb_array_elements_text(p.report -> 'created') x(item)
       where (p_tenant is null or p.tenant_id = p_tenant) and (x.item like 'media:%' or x.item like 'exception:%')
      union all
      select p.tenant_id, p.id, x.item, 'deleted'
        from private.tenant_publications p, jsonb_array_elements_text(p.report -> 'deleted') x(item)
       where (p_tenant is null or p.tenant_id = p_tenant) and (x.item like 'media:%' or x.item like 'exception:%')
    ),
    seq as (
      select tenant_id, item, what,
             lag(what) over (partition by tenant_id, item order by id) as prev,
             row_number() over (partition by tenant_id, item order by id desc) as rn
        from ev
    )
    select tenant_id, item from seq where rn = 1 and what = 'created' and prev = 'created'
  loop
    v_id := null;
    if r.item like 'media:%' then
      delete from public.media
       where tenant_id = r.tenant_id and key = substr(r.item, 7) and source = 'config' and config_sig is not null
      returning id into v_id;
      if v_id is not null then
        insert into private.owner_removed_config (tenant_id, kind, key)
        values (r.tenant_id, 'media', substr(r.item, 7)) on conflict do nothing;
      end if;
    else
      delete from public.business_exceptions
       where tenant_id = r.tenant_id and day = substr(r.item, 11)::date and config_sig is not null
      returning id into v_id;
      if v_id is not null then
        insert into private.owner_removed_config (tenant_id, kind, key)
        values (r.tenant_id, 'exception', to_char(substr(r.item, 11)::date, 'YYYY-MM-DD')) on conflict do nothing;
      end if;
    end if;
    if v_id is not null then
      v_done := v_done || to_jsonb(r.item);
    end if;
  end loop;
  return v_done;
end;
$$;

revoke execute on function private.restore_owner_removals(uuid) from public, anon, authenticated, service_role;

select private.restore_owner_removals();
