-- Notification outbox. Booking transactions only INSERT jobs; delivery happens later in
-- the notify-dispatcher Edge Function, which leases jobs, sends Web Push and reports back.
--
-- Guarantees:
--   * one job per (tenant, dedupe_key): retrying a booking operation cannot enqueue twice;
--   * leases with expiry: a crashed worker's jobs are picked up again after the lease ends;
--   * only the current lease holder can complete a job;
--   * per-subscription deliveries are recorded, so a retried job never re-sends to a
--     device that already received it;
--   * demo tenants and demo records never deliver (status 'suppressed' at enqueue time and
--     re-checked at lease time).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  audience text not null check (audience in ('client', 'owner')),
  client_profile_id uuid,
  booking_id uuid,
  user_id uuid references auth.users (id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  disabled_at timestamptz,
  disabled_reason text,
  unique (tenant_id, id),
  unique (tenant_id, endpoint),
  check ((audience = 'owner' and user_id is not null and client_profile_id is null and booking_id is null)
      or (audience = 'client' and user_id is null and (client_profile_id is not null or booking_id is not null))),
  foreign key (tenant_id, client_profile_id) references public.client_profiles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  booking_id uuid,
  event text not null check (event in ('booking.created', 'booking.confirmed', 'booking.moved',
                                       'booking.cancelled', 'booking.reminder')),
  audience text not null check (audience in ('client', 'owner')),
  channel text not null default 'push' check (channel in ('push')),
  dedupe_key text not null check (length(dedupe_key) <= 200),
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'leased', 'sent', 'failed', 'suppressed', 'dead')),
  attempts int not null default 0,
  max_attempts int not null default 5 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  suppressed_reason text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key),
  unique (tenant_id, id),
  check ((status = 'leased') = (lease_owner is not null and lease_expires_at is not null)),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);
create index notification_jobs_due_idx on public.notification_jobs (next_attempt_at) where status = 'pending';
create index notification_jobs_lease_idx on public.notification_jobs (lease_expires_at) where status = 'leased';
create index notification_jobs_booking_idx on public.notification_jobs (tenant_id, booking_id);

create table public.notification_deliveries (
  job_id uuid not null references public.notification_jobs (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  tenant_id uuid not null,
  status text not null check (status in ('sent', 'gone', 'failed')),
  http_status int,
  error text check (error is null or length(error) <= 300),
  created_at timestamptz not null default now(),
  primary key (job_id, subscription_id)
);

alter table public.push_subscriptions enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.notification_deliveries enable row level security;

-- Owners/managers can audit the outbox of their studio (status, attempts, errors).
create policy notification_jobs_manager_read on public.notification_jobs for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids('manager'))::uuid[]));
grant select on public.notification_jobs to authenticated;
-- push_subscriptions / notification_deliveries: server only.

-- Enqueue one job. Delivery policy (demo/disabled) is decided here and re-checked at lease.
create or replace function private.enqueue_notification(
  p_tenant uuid,
  p_booking uuid,
  p_event text,
  p_audience text,
  p_dedupe_key text,
  p_payload jsonb,
  p_not_before timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_status text;
  v_is_demo boolean := false;
  v_owner_on boolean;
  v_client_on boolean;
  v_status text := 'pending';
  v_reason text;
begin
  select t.status, s.notify_owner_push, s.notify_client_push
    into v_tenant_status, v_owner_on, v_client_on
  from public.tenants t join public.tenant_settings s on s.tenant_id = t.id
  where t.id = p_tenant;

  if p_booking is not null then
    select b.is_demo into v_is_demo from public.bookings b where b.tenant_id = p_tenant and b.id = p_booking;
  end if;

  if v_tenant_status is distinct from 'live' then
    v_status := 'suppressed'; v_reason := 'tenant_not_live';
  elsif v_is_demo then
    v_status := 'suppressed'; v_reason := 'demo_record';
  elsif p_audience = 'owner' and not v_owner_on then
    v_status := 'suppressed'; v_reason := 'disabled_by_settings';
  elsif p_audience = 'client' and not v_client_on then
    v_status := 'suppressed'; v_reason := 'disabled_by_settings';
  end if;

  insert into public.notification_jobs
    (tenant_id, booking_id, event, audience, dedupe_key, payload, status, suppressed_reason, next_attempt_at)
  values
    (p_tenant, p_booking, p_event, p_audience, p_dedupe_key, coalesce(p_payload, '{}'), v_status, v_reason,
     greatest(coalesce(p_not_before, now()), now()))
  on conflict (tenant_id, dedupe_key) do nothing;
end;
$$;

-- Jobs for a booking lifecycle event (both audiences, plus the reminder when relevant).
create or replace function private.enqueue_booking_event(p_booking uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  v_reminder_hours int;
  v_reminder_at timestamptz;
  v_suffix text;
  v_payload jsonb;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then
    return;
  end if;
  v_suffix := case p_event when 'booking.moved' then ':v' || b.version else '' end;
  v_payload := jsonb_build_object('starts_at', b.starts_at, 'version', b.version, 'status', b.status);

  perform private.enqueue_notification(b.tenant_id, b.id, p_event, 'owner',
    'booking:' || b.id || ':' || p_event || v_suffix || ':owner', v_payload);
  perform private.enqueue_notification(b.tenant_id, b.id, p_event, 'client',
    'booking:' || b.id || ':' || p_event || v_suffix || ':client', v_payload);

  if p_event in ('booking.created', 'booking.moved', 'booking.confirmed') and b.status in ('pending', 'confirmed') then
    select reminder_hours_before into v_reminder_hours from public.tenant_settings where tenant_id = b.tenant_id;
    v_reminder_at := b.starts_at - make_interval(hours => v_reminder_hours);
    if v_reminder_at > now() then
      -- Keyed on the start time: a moved booking gets a new reminder, the old one is
      -- detected as stale by the dispatcher and suppressed.
      perform private.enqueue_notification(b.tenant_id, b.id, 'booking.reminder', 'client',
        'booking:' || b.id || ':reminder:' || extract(epoch from b.starts_at)::bigint, v_payload, v_reminder_at);
    end if;
  end if;
end;
$$;
