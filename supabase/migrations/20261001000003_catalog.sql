-- Catalog: resources, services (+ body-type variants and add-ons), schedule, media.
-- Every tenant-owned table carries tenant_id and exposes UNIQUE (tenant_id, id) so that
-- child rows reference parents with composite foreign keys: a row can never point to an
-- entity of another tenant, even through a bug in application code.

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key public.entity_key not null,
  name text not null check (length(btrim(name)) between 1 and 60),
  -- Free-form physical type: detail_bay, wash_bay, polish_station, ceramic_booth, ppf_booth...
  type text not null check (type ~ '^[a-z][a-z0-9_]{0,39}$'),
  active boolean not null default true,
  sort_order int not null default 0,
  config_sig text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key),
  unique (tenant_id, id)
);
create trigger resources_touch before update on public.resources
  for each row execute function private.touch_updated_at();

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key public.entity_key not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  category text not null default 'other' check (category ~ '^[a-z][a-z0-9_]{0,39}$'),
  summary text not null default '' check (length(summary) <= 200),
  description text not null default '' check (length(description) <= 4000),
  -- Work time in minutes. For multi_day services the work is spread over working
  -- windows and the resource stays occupied continuously (the car stays in the bay).
  duration_min int not null check (duration_min between 5 and 20160),
  buffer_before_min int not null default 0 check (buffer_before_min between 0 and 240),
  buffer_after_min int not null default 0 check (buffer_after_min between 0 and 240),
  price_cents public.money_cents not null,
  resource_types text[] not null check (cardinality(resource_types) between 1 and 10),
  multi_day boolean not null default false,
  requires_confirmation boolean not null default false,
  allowed_body_types text[], -- null: every body type
  benefits text[] not null default '{}',
  prep_notes text[] not null default '{}',
  restrictions text[] not null default '{}',
  recommended_keys text[] not null default '{}',
  -- Used for "it has been a while since ..." suggestions; null disables them.
  repeat_interval_days int check (repeat_interval_days is null or repeat_interval_days between 7 and 1095),
  active boolean not null default true,
  bookable_online boolean not null default true,
  sort_order int not null default 0,
  config_sig text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key),
  unique (tenant_id, id)
);
create trigger services_touch before update on public.services
  for each row execute function private.touch_updated_at();

-- Price/duration override for a body type. Missing row -> base service values.
create table public.service_variants (
  tenant_id uuid not null,
  service_id uuid not null,
  body_type public.body_type not null,
  price_cents public.money_cents not null,
  duration_min int not null check (duration_min between 5 and 20160),
  primary key (service_id, body_type),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete cascade
);
create index service_variants_tenant_idx on public.service_variants (tenant_id);

create table public.service_addons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  service_id uuid not null,
  key public.entity_key not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 500),
  price_cents public.money_cents not null,
  duration_min int not null default 0 check (duration_min between 0 and 1440),
  active boolean not null default true,
  sort_order int not null default 0,
  config_sig text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, service_id, key),
  unique (tenant_id, id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete cascade
);
create trigger service_addons_touch before update on public.service_addons
  for each row execute function private.touch_updated_at();

-- Weekly hours in tenant-local time. closes <= opens means the window ends the next day
-- (overnight). '24:00' is a valid closing time. Several windows per weekday are allowed.
create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  opens time not null,
  closes time not null,
  check (opens <> closes),
  unique (tenant_id, weekday, opens)
);

-- Date-specific override in tenant-local time: closed day or special hours.
create table public.business_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  day date not null,
  closed boolean not null,
  opens time,
  closes time,
  note text not null default '' check (length(note) <= 200),
  config_sig text,
  created_at timestamptz not null default now(),
  check ((closed and opens is null and closes is null)
      or (not closed and opens is not null and closes is not null and opens <> closes)),
  unique (tenant_id, day)
);

-- Media metadata. Binaries live in Supabase Storage: `public-media` (branding, services,
-- gallery) or `private-media` (customer vehicles, before/after photos, served via
-- short-lived signed URLs only).
create table public.media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key public.entity_key, -- stable key for config-managed media
  kind text not null check (kind in ('logo', 'icon', 'hero', 'gallery', 'service', 'vehicle', 'before', 'after')),
  bucket text not null check (bucket in ('public-media', 'private-media')),
  path text not null check (path ~ '^[0-9a-f-]{36}/[A-Za-z0-9/_.-]{1,200}$'),
  -- Responsive variants: [{"w": 480, "path": "..."}, ...]
  variants jsonb not null default '[]' check (jsonb_typeof(variants) = 'array'),
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  alt text not null default '' check (length(alt) <= 200),
  caption text not null default '' check (length(caption) <= 200),
  service_id uuid,
  booking_id uuid,
  vehicle_id uuid,
  client_visible boolean not null default true,
  source text not null check (source in ('config', 'owner', 'client')),
  sort_order int not null default 0,
  config_sig text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- public assets must not reference private buckets and vice versa
  check ((kind in ('vehicle', 'before', 'after')) = (bucket = 'private-media')),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete set null (service_id)
);
-- The tenant_id prefix of the storage path must be the row's tenant.
alter table public.media add constraint media_path_tenant check (split_part(path, '/', 1) = tenant_id::text);
create unique index media_config_key_idx on public.media (tenant_id, key) where key is not null;
create index media_service_idx on public.media (tenant_id, service_id) where service_id is not null;
-- One stored object may back several rows (the same photo used for two services).
create index media_path_idx on public.media (bucket, path);

alter table public.resources enable row level security;
alter table public.services enable row level security;
alter table public.service_variants enable row level security;
alter table public.service_addons enable row level security;
alter table public.business_hours enable row level security;
alter table public.business_exceptions enable row level security;
alter table public.media enable row level security;

create policy resources_member_read on public.resources for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));
create policy services_member_read on public.services for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));
create policy service_variants_member_read on public.service_variants for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));
create policy service_addons_member_read on public.service_addons for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));
create policy business_hours_member_read on public.business_hours for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));
create policy business_exceptions_member_read on public.business_exceptions for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));
create policy media_member_read on public.media for select to authenticated
  using (tenant_id = any ((select private.my_tenant_ids())::uuid[]));

grant select on public.resources, public.services, public.service_variants, public.service_addons,
  public.business_hours, public.business_exceptions, public.media to authenticated;
