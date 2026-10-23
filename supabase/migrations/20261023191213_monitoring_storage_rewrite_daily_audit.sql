set local lock_timeout='5s';
set local statement_timeout='120s';
do $$begin if exists(select 1 from private.monitoring_archive_control where active and not maintenance) then raise exception 'ARCHIVE_MAINTENANCE_REQUIRED';end if;end $$;
cluster private.daily_call_audit using daily_call_audit_pkey;
analyze private.daily_call_audit;
alter table private.daily_call_audit set(autovacuum_vacuum_scale_factor=0.02,autovacuum_vacuum_threshold=500,autovacuum_analyze_scale_factor=0.05,autovacuum_analyze_threshold=500);
