-- Read-only inventory. This file never changes read-only mode, data, queues or plans.
-- The dates below illustrate a three-cycle retention window on 2026-10-20.
select jsonb_build_object(
 'asOf',clock_timestamp(),
 'databaseBytes',pg_database_size(current_database()),
 'defaultReadOnly',current_setting('default_transaction_read_only'),
 'sources',(select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'identityNamespace',identity_namespace)) from public.monitoring_sources),
 'storage',(select jsonb_build_object('objects',count(*),'bytes',sum((metadata->>'size')::bigint)) from storage.objects),
 'relations',(select jsonb_agg(jsonb_build_object('name',relid::regclass::text,'bytes',pg_total_relation_size(relid),'estimatedRows',n_live_tup))
   from pg_stat_user_tables where relname in ('monitoring_events','monitoring_occurrences','monitoring_results','monitoring_jobs','monitoring_audit')),
 'events',(select jsonb_build_object('rows',count(*),'recentRows',count(*) filter(where occurred_at >= '2026-07-20T00:00:00-03:00'),
   'oldRows',count(*) filter(where occurred_at < '2026-07-20T00:00:00-03:00')) from public.monitoring_events),
 'results',(select jsonb_build_object('rows',count(*),'activeRecent',count(*) filter(where active and operational_date >= '2026-07-21'),
   'inactive',count(*) filter(where not active)) from public.monitoring_results),
 'foreignKeys',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'definition',pg_get_constraintdef(oid))) from pg_constraint
   where contype='f' and confrelid in ('public.monitoring_events'::regclass,'public.monitoring_occurrences'::regclass,'public.monitoring_results'::regclass))
) as archive_inventory;
