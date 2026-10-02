-- AI budget reservation is serialized per studio (see tests/db/limits.test.ts).

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
  -- One reservation at a time per studio: the limit checks below must see every request
  -- committed before this one (a plain UPDATE ... WHERE (select sum(...)) < limit does not,
  -- and a burst of parallel requests went over the limit).
  perform pg_advisory_xact_lock(hashtextextended('ai_budget:' || p_tenant::text, 0));
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
