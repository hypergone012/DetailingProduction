-- Owner-created bookings become idempotent (optional key in the payload), like client ones.

-- payload: {customer: {id} | {name, phone, email}, vehicle: {id} | {make, model, body_type, ...} | null,
--           service_id, addon_ids[], starts_at, resource_id?, allow_outside_hours?, status?, note?, internal_note?,
--           idempotency_key?}
-- With idempotency_key, a retry of the same request (e.g. after a timeout on a phone) returns
-- the booking the first attempt created instead of creating a second one.
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
  v_key text := nullif(p_payload ->> 'idempotency_key', '');
  v_replay jsonb;
begin
  perform private.require_role(p_tenant, 'manager');
  if v_key is not null then
    v_replay := private.claim_idempotency(p_tenant, 'owner.booking', v_key,
      encode(sha256(convert_to((p_payload - 'idempotency_key')::text, 'UTF8')), 'hex'));
    if v_replay ? 'booking_id' then
      return private.booking_json((v_replay ->> 'booking_id')::uuid, false) || jsonb_build_object('replayed', true);
    end if;
  end if;
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
  if v_key is not null then
    perform private.store_idempotency(p_tenant, 'owner.booking', v_key, jsonb_build_object('booking_id', v_booking));
  end if;
  return private.booking_json(v_booking, false) || jsonb_build_object('replayed', false);
end;
$$;
