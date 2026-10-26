-- Existing installations receive the same coordination as cloud-monitoring-cron.sql.
-- Keep the scheduled endpoint and token/lease protocol intact.
set local lock_timeout='5s';
do $$declare definition text;needle text:='token:=private.monitoring_cloud_issue_dispatch();';begin
 if to_regprocedure('private.monitoring_cloud_dispatch_tick()') is not null then
  definition:=pg_get_functiondef('private.monitoring_cloud_dispatch_tick()'::regprocedure);
  if strpos(definition,needle)=0 then raise exception 'CLOUD_DISPATCH_DEFINITION_CHANGED';end if;
  if strpos(definition,'perform pg_advisory_xact_lock(824202609,1);')=0 then
   execute replace(definition,needle,'perform pg_advisory_xact_lock(824202609,1);'||chr(10)||' '||needle);
  end if;
  execute 'alter function private.monitoring_cloud_dispatch_tick() set lock_timeout=''25s''';
 end if;
 -- A round may span several minutes. Defer lifecycle checks while its fenced
 -- lease is live so they cannot interrupt a later batch in that same round.
 definition:=pg_get_functiondef('private.employee_lifecycle_tick()'::regprocedure);
 needle:='if not pg_try_advisory_xact_lock(824202609,1) then return jsonb_build_object(''busy'',true,''checked'',0,''returned'',0);end if;';
 if strpos(definition,needle)=0 then raise exception 'CLOUD_LIFECYCLE_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,needle||chr(10)||$guard$
 if exists(select 1 from private.monitoring_cloud_jobs where status='processing' and lease_expires_at>clock_timestamp()) then
  return jsonb_build_object('busy',true,'checked',0,'returned',0);
 end if;$guard$);
end $$;
