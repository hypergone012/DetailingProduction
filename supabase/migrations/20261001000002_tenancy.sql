-- Tenancy: studios, their settings and staff membership.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'
           and slug not in ('owner', 'api', 'admin', 'assets', 'static', 'www', 'app', 'new', 's', 't')),
  name text not null check (length(btrim(name)) between 1 and 80),
  -- draft: not public. demo: public, seed data only, notifications never delivered.
  -- live: real operation. suspended: not public.
  status text not null default 'draft' check (status in ('draft', 'demo', 'live', 'suspended')),
  timezone text not null check (private.is_valid_timezone(timezone)),
  locale text not null default 'ru-RU' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  currency text not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  config_sig text,
  live_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger tenants_touch before update on public.tenants
  for each row execute function private.touch_updated_at();

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  -- Public business profile.
  tagline text not null default '' check (length(tagline) <= 160),
  description text not null default '' check (length(description) <= 4000),
  address text not null default '' check (length(address) <= 300),
  map_url text check (map_url is null or map_url ~ '^https://'),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  website text check (website is null or website ~ '^https://'),
  socials jsonb not null default '[]' check (jsonb_typeof(socials) = 'array'),
  -- Presentation (validated by the shared Zod schema before it reaches the DB).
  branding jsonb not null default '{}' check (jsonb_typeof(branding) = 'object'),
  seo jsonb not null default '{}' check (jsonb_typeof(seo) = 'object'),
  features jsonb not null default '{}' check (jsonb_typeof(features) = 'object'),
  -- Booking policy (typed: the engine reads these).
  slot_step_min int not null default 30 check (slot_step_min in (5, 10, 15, 20, 30, 60)),
  min_notice_min int not null default 120 check (min_notice_min between 0 and 10080),
  horizon_days int not null default 45 check (horizon_days between 1 and 365),
  cancel_cutoff_hours int not null default 24 check (cancel_cutoff_hours between 0 and 336),
  requires_confirmation boolean not null default false,
  max_active_bookings_per_phone int not null default 3 check (max_active_bookings_per_phone between 1 and 50),
  reminder_hours_before int not null default 24 check (reminder_hours_before between 1 and 168),
  -- Notifications.
  notify_owner_push boolean not null default true,
  notify_client_push boolean not null default true,
  -- AI budget (per tenant-local day).
  ai_daily_request_limit int not null default 300 check (ai_daily_request_limit between 0 and 100000),
  ai_daily_token_budget int not null default 300000 check (ai_daily_token_budget between 0 and 100000000),
  -- Config-managed signatures: null means an owner edited the value after the last publish.
  config_sig text,
  hours_config_sig text,
  updated_at timestamptz not null default now()
);
create trigger tenant_settings_touch before update on public.tenant_settings
  for each row execute function private.touch_updated_at();

create table public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on public.tenant_members (user_id);

-- Role rank: staff < manager < owner.
create or replace function private.role_rank(p_role text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_role when 'owner' then 3 when 'manager' then 2 when 'staff' then 1 else 0 end
$$;

-- Tenants where the current user has at least p_min_role. Used in RLS as
-- `tenant_id = any ((select private.my_tenant_ids())::uuid[])` so it is evaluated once per query.
create or replace function private.my_tenant_ids(p_min_role text default 'staff')
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.tenant_id), '{}')
  from public.tenant_members m
  where m.user_id = (select auth.uid())
    and private.role_rank(m.role) >= private.role_rank(p_min_role)
$$;

create or replace function private.has_role(p_tenant uuid, p_min_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = p_tenant
      and m.user_id = (select auth.uid())
      and private.role_rank(m.role) >= private.role_rank(p_min_role)
  )
$$;

-- Owner RPC guard. Unknown tenant and missing membership are indistinguishable (NOT_FOUND)
-- so a foreign tenant id cannot be probed.
create or replace function private.require_role(p_tenant uuid, p_min_role text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('UNAUTHENTICATED', 'Требуется вход');
  end if;
  if p_tenant is null or not private.has_role(p_tenant, 'staff') then
    perform private.fail('NOT_FOUND', 'Студия не найдена');
  end if;
  if not private.has_role(p_tenant, p_min_role) then
    perform private.fail('FORBIDDEN', 'Недостаточно прав');
  end if;
end;
$$;

grant execute on function private.role_rank(text) to authenticated, service_role;
grant execute on function private.my_tenant_ids(text) to authenticated, service_role;
grant execute on function private.has_role(uuid, text) to authenticated, service_role;

alter table public.tenants enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.tenant_members enable row level security;

create policy tenants_member_read on public.tenants
  for select to authenticated
  using (id = any ((select private.my_tenant_ids())::uuid[]));

create policy tenant_settings_member_read on public.tenant_settings
  for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));

-- Members see their colleagues within their own tenants only.
create policy tenant_members_member_read on public.tenant_members
  for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));

grant select on public.tenants, public.tenant_settings, public.tenant_members to authenticated;
