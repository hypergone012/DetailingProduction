-- Supabase Cron schedules as a function. Migration …010 schedules the jobs only when pg_cron
-- and pg_net already exist; the deploy workflow enables them and then calls this, so the
-- order no longer matters. cron.schedule() upserts by job name: calling it again is safe.

create or replace function private.ensure_schedules()
returns text
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 'skipped: pg_cron/pg_net not installed';
  end if;
  perform cron.schedule('notify-dispatch', '* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notify-dispatcher',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-dispatcher-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatcher_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 25000)
  $job$);
  perform cron.schedule('housekeeping', '17 3 * * *', 'select public.api_housekeeping()');
  return 'scheduled';
end;
$$;

revoke all on function private.ensure_schedules() from public;

select private.ensure_schedules();
