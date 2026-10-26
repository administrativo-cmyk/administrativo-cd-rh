-- MANUAL ACTIVATION ONLY, after the cloud runner deployment and its read-only checks.
-- Target: administrativo-cd-rh. No permanent credentials, Vault secrets or local paths.
-- Review the fixed production URL before executing. This script does not upload files.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function private.monitoring_cloud_dispatch_tick() returns bigint
language plpgsql security definer set search_path='' set lock_timeout='25s' as $$
declare token text; request_id bigint;
begin
 -- Lifecycle checks use this lock before cloud routing. Wait in the scheduler,
 -- before issuing a short-lived token or consuming an import attempt.
 perform pg_advisory_xact_lock(824202609,1);
 token:=private.monitoring_cloud_issue_dispatch();
 if token is null then return null; end if;
 select net.http_post(
  url:='https://administrativo-cd-rh.vercel.app/api/monitoring/cloud/run',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
  body:='{}'::jsonb,timeout_milliseconds:=240000
 ) into request_id;
 return request_id;
end $$;
revoke all on function private.monitoring_cloud_dispatch_tick() from public,anon,authenticated,service_role;

-- A stable job name replaces the same schedule instead of creating duplicate invocations.
select cron.schedule('monitoring-cloud-dispatch','* * * * *','select private.monitoring_cloud_dispatch_tick()');
commit;

-- Verify installed pg_net version and HTTP response completion separately from Cron SQL success.
select extname,extversion from pg_extension where extname in ('pg_cron','pg_net');
select jobname,schedule,active from cron.job where jobname='monitoring-cloud-dispatch';
-- Health only: never select request headers, tokens or source-file contents for diagnostics.
-- select status_code,error_msg from net._http_response order by created desc limit 5;
-- Rollback activation (keeps queued files): select cron.unschedule('monitoring-cloud-dispatch');
