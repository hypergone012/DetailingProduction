-- Customers (studio CRM, one per phone), client profiles (device identity without
-- registration) and vehicles (the "garage").
--
-- A client profile is created on the first booking or the first saved vehicle. The device
-- keeps a random 256-bit key; only its SHA-256 is stored. A profile sees ONLY vehicles and
-- bookings created through it. Matching a phone number never grants access to other data
-- of the customer with that phone: the CRM merge is owner-side only.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  phone_e164 public.phone_e164,
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  owner_notes text not null default '' check (length(owner_notes) <= 4000),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index customers_phone_idx on public.customers (tenant_id, phone_e164) where phone_e164 is not null;
create index customers_name_idx on public.customers (tenant_id, lower(name));
create trigger customers_touch before update on public.customers
  for each row execute function private.touch_updated_at();

create table public.client_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid,
  key_hash bytea not null unique check (octet_length(key_hash) = 32),
  display_name text check (display_name is null or length(btrim(display_name)) between 1 and 120),
  phone_e164 public.phone_e164,
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete set null (customer_id)
);

create table public.customer_vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid,
  client_profile_id uuid,
  nickname text check (nickname is null or length(btrim(nickname)) between 1 and 40),
  make text not null check (length(btrim(make)) between 1 and 40),
  model text not null check (length(btrim(model)) between 1 and 60),
  generation text check (generation is null or length(generation) <= 40),
  year int check (year is null or year between 1950 and 2100),
  body_type public.body_type not null,
  color text check (color is null or length(color) <= 40),
  plate text check (plate is null or length(plate) <= 16),
  client_comment text not null default '' check (length(client_comment) <= 500),
  owner_notes text not null default '' check (length(owner_notes) <= 2000),
  photo_media_id uuid,
  is_demo boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (customer_id is not null or client_profile_id is not null),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete set null (customer_id),
  foreign key (tenant_id, client_profile_id) references public.client_profiles (tenant_id, id) on delete set null (client_profile_id),
  foreign key (tenant_id, photo_media_id) references public.media (tenant_id, id) on delete set null (photo_media_id)
);
create index customer_vehicles_customer_idx on public.customer_vehicles (tenant_id, customer_id);
create index customer_vehicles_profile_idx on public.customer_vehicles (tenant_id, client_profile_id);
create trigger customer_vehicles_touch before update on public.customer_vehicles
  for each row execute function private.touch_updated_at();

alter table public.media
  add foreign key (tenant_id, vehicle_id) references public.customer_vehicles (tenant_id, id) on delete cascade;

alter table public.customers enable row level security;
alter table public.client_profiles enable row level security;
alter table public.customer_vehicles enable row level security;

create policy customers_member_read on public.customers for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));
create policy customer_vehicles_member_read on public.customer_vehicles for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));
-- client_profiles: no policy and no grant. key_hash never leaves the server.

grant select on public.customers, public.customer_vehicles to authenticated;
