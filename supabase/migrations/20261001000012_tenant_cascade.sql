-- Every tenant-owned row references its tenant directly, so deleting a studio (closing an
-- account, removing a test studio) removes all of its data in one statement. Before this,
-- resource blocks (occupancies without a booking) had no cascade path and blocked the
-- delete; the other tables only cascaded through a parent row.
alter table public.resource_occupancies
  add foreign key (tenant_id) references public.tenants (id) on delete cascade;
alter table public.booking_access_tokens
  add foreign key (tenant_id) references public.tenants (id) on delete cascade;
alter table public.booking_events
  add foreign key (tenant_id) references public.tenants (id) on delete cascade;
alter table public.booking_items
  add foreign key (tenant_id) references public.tenants (id) on delete cascade;
alter table public.notification_deliveries
  add foreign key (tenant_id) references public.tenants (id) on delete cascade;
alter table public.service_addons
  add foreign key (tenant_id) references public.tenants (id) on delete cascade;
alter table public.service_variants
  add foreign key (tenant_id) references public.tenants (id) on delete cascade;
