set local lock_timeout='5s';
set local statement_timeout='120s';
do $$begin if exists(select 1 from private.monitoring_archive_control where active and not maintenance) then raise exception 'ARCHIVE_MAINTENANCE_REQUIRED';end if;end $$;
cluster public.monitoring_results using monitoring_results_pkey;
analyze public.monitoring_results;
alter table public.monitoring_results set(autovacuum_vacuum_scale_factor=0.02,autovacuum_vacuum_threshold=500,autovacuum_analyze_scale_factor=0.05,autovacuum_analyze_threshold=500);
