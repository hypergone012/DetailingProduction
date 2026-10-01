-- Bookings, the single occupancy ledger, history, access tokens and payments.

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[2-9A-Z]{6}$'),
  customer_id uuid not null,
  vehicle_id uuid,
  client_profile_id uuid,
  service_id uuid not null,
  resource_id uuid not null,
  status text not null check (status in ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
  starts_at timestamptz not null,
  ends_at timestamptz not null, -- end of work; the occupancy adds buffers around it
  -- Snapshot taken at booking time. Later catalog changes never rewrite these.
  service_name text not null,
  body_type public.body_type,
  work_minutes int not null check (work_minutes > 0),
  buffer_before_min int not null check (buffer_before_min >= 0),
  buffer_after_min int not null check (buffer_after_min >= 0),
  multi_day boolean not null,
  price_cents public.money_cents not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  customer_note text not null default '' check (length(customer_note) <= 1000),
  internal_note text not null default '' check (length(internal_note) <= 4000),
  client_note text not null default '' check (length(client_note) <= 2000), -- studio note shown to the client
  source text not null check (source in ('client', 'owner', 'assistant')),
  version int not null default 1,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by is null or cancelled_by in ('client', 'owner', 'system')),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  check (ends_at > starts_at),
  unique (tenant_id, id),
  unique (tenant_id, code),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references public.customer_vehicles (tenant_id, id),
  foreign key (tenant_id, client_profile_id) references public.client_profiles (tenant_id, id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id),
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id)
);
create index bookings_tenant_start_idx on public.bookings (tenant_id, starts_at);
create index bookings_customer_idx on public.bookings (tenant_id, customer_id, starts_at desc);
create index bookings_vehicle_idx on public.bookings (tenant_id, vehicle_id, starts_at desc);
create index bookings_profile_idx on public.bookings (tenant_id, client_profile_id, starts_at desc);
create trigger bookings_touch before update on public.bookings
  for each row execute function private.touch_updated_at();

-- Line items with the price and duration in force at booking time.
create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('service', 'addon', 'adjustment')),
  ref_id uuid,
  name text not null,
  price_cents bigint not null check (price_cents between -100000000000 and 100000000000),
  minutes int not null default 0 check (minutes >= 0),
  sort_order int not null default 0,
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);
create index booking_items_booking_idx on public.booking_items (tenant_id, booking_id);

-- The ONE ledger of resource time. Bookings and manual blocks both live here, and the
-- exclusion constraint makes overlapping active intervals on one resource impossible,
-- whatever code path inserts them.
create table public.resource_occupancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  resource_id uuid not null,
  kind text not null check (kind in ('booking', 'block')),
  booking_id uuid,
  block_reason text check (block_reason is null or block_reason in ('maintenance', 'closed', 'personal', 'reserve', 'other')),
  title text check (title is null or length(title) <= 120),
  note text check (note is null or length(note) <= 1000),
  during tstzrange not null,
  released_at timestamptz,
  release_reason text check (release_reason is null or release_reason in ('cancelled', 'rescheduled', 'no_show', 'removed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (not isempty(during) and lower_inc(during) and not upper_inc(during)
         and not lower_inf(during) and not upper_inf(during)),
  check ((kind = 'booking' and booking_id is not null and block_reason is null)
      or (kind = 'block' and booking_id is null and block_reason is not null)),
  check ((released_at is null) = (release_reason is null)),
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade,
  constraint resource_occupancies_no_overlap
    exclude using gist (resource_id with =, during with &&) where (released_at is null)
);
create unique index resource_occupancies_one_active_per_booking
  on public.resource_occupancies (booking_id) where released_at is null and kind = 'booking';
create index resource_occupancies_tenant_during_idx
  on public.resource_occupancies using gist (tenant_id, during) where released_at is null;

create table public.booking_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  booking_id uuid not null,
  event text not null check (event in ('created', 'moved', 'cancelled', 'confirmed', 'started', 'completed',
                                       'no_show', 'price_changed', 'note_changed')),
  data jsonb not null default '{}',
  actor text not null check (actor in ('client', 'owner', 'assistant', 'system')),
  actor_user uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);
create index booking_events_booking_idx on public.booking_events (tenant_id, booking_id, id);

-- Capability tokens for one booking. Only SHA-256(token) is stored; the plaintext is
-- derived server-side (HMAC with a server secret) and shown to the client once.
create table public.booking_access_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  purpose text not null check (purpose in ('client', 'owner_share')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);
create index booking_access_tokens_booking_idx on public.booking_access_tokens (tenant_id, booking_id);

-- Money actually received (or refunded). Never derived from booking prices.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  booking_id uuid,
  customer_id uuid,
  kind text not null check (kind in ('payment', 'refund')),
  method text not null check (method in ('cash', 'card', 'transfer', 'online', 'other')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  paid_at timestamptz not null default now(),
  note text not null default '' check (length(note) <= 500),
  idempotency_key text check (idempotency_key is null or length(idempotency_key) between 8 and 100),
  recorded_by uuid,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id)
);
create unique index payments_idempotency_idx on public.payments (tenant_id, idempotency_key) where idempotency_key is not null;
create index payments_paid_at_idx on public.payments (tenant_id, paid_at);
create index payments_booking_idx on public.payments (tenant_id, booking_id);

alter table public.media
  add foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade;

-- tenant_id is immutable on every tenant-owned table.
create or replace function private.forbid_tenant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    perform private.fail('TENANT_IMMUTABLE', 'tenant_id cannot change');
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['tenant_settings', 'tenant_members', 'resources', 'services', 'service_variants',
    'service_addons', 'business_hours', 'business_exceptions', 'media', 'customers', 'client_profiles',
    'customer_vehicles', 'bookings', 'booking_items', 'resource_occupancies', 'booking_events',
    'booking_access_tokens', 'payments']
  loop
    execute format('create trigger %I before update of tenant_id on public.%I for each row execute function private.forbid_tenant_change()',
                   t || '_tenant_immutable', t);
  end loop;
end;
$$;

alter table public.bookings enable row level security;
alter table public.booking_items enable row level security;
alter table public.resource_occupancies enable row level security;
alter table public.booking_events enable row level security;
alter table public.booking_access_tokens enable row level security;
alter table public.payments enable row level security;

create policy bookings_member_read on public.bookings for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));
create policy booking_items_member_read on public.booking_items for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));
create policy resource_occupancies_member_read on public.resource_occupancies for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));
create policy booking_events_member_read on public.booking_events for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));
-- Money is visible to managers and owners only.
create policy payments_manager_read on public.payments for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids('manager'))::uuid[]));
-- booking_access_tokens: no policy and no grant (hashes never leave the server).

grant select on public.bookings, public.booking_items, public.resource_occupancies,
  public.booking_events, public.payments to authenticated;
