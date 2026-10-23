-- Ordinary coverage initialization must not revoke a day already queued or
-- being calculated. Actual event/coverage changes still fence the old lease.
do $$declare definition text;needle text;begin
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(791704);
 if exists(select 1 from private.monitoring_cloud_jobs where status in('uploading','queued','processing')) then
  raise exception 'INCREMENTAL_IMPORTS_ACTIVE';
 end if;
 definition:=replace(pg_get_functiondef('private.monitoring_ingest_before_source_management(jsonb)'::regprocedure),E'\r\n',E'\n');
 needle:=$old$and (v_coverage_changed or not exists(select 1 from public.monitoring_results r
    where r.employee_id=b.employee_id and r.operational_date=d::date and r.active and not r.dirty))$old$;
 if strpos(definition,needle)=0 then raise exception 'INCREMENTAL_QUEUED_COVERAGE_CHANGED';end if;
 execute replace(definition,needle,$patch$and (v_coverage_changed or (
    not exists(select 1 from public.monitoring_results r
     where r.employee_id=b.employee_id and r.operational_date=d::date and r.active and not r.dirty)
    and not exists(select 1 from public.monitoring_jobs queued
     where queued.employee_id=b.employee_id and queued.operational_date=d::date)))$patch$);
end $$;
