-- Read-only aggregates; no employee identifiers, names, photo bytes or credentials.
-- Target: administrativo-cd-rh / kqgtnucqxqqgwdyvhvdd.
-- Legacy snapshot counts are activation checks; employees created later may lack a legacy snapshot.
with counts as (
 select 'colaboradores' dataset,count(*) total from public.colaboradores
 union all select 'banco_horas_medicoes',count(*) from public.banco_horas_medicoes
 union all select 'chamada_diaria',count(*) from public.chamada_diaria
 union all select 'perfis',count(*) from public.perfis
 union all select 'monitoring_sources',count(*) from public.monitoring_sources
 union all select 'monitoring_files',count(*) from public.monitoring_files
 union all select 'monitoring_batches',count(*) from public.monitoring_batches
 union all select 'monitoring_attempts',count(*) from public.monitoring_attempts
 union all select 'monitoring_events',count(*) from public.monitoring_events
 union all select 'monitoring_occurrences',count(*) from public.monitoring_occurrences
 union all select 'monitoring_people',count(*) from public.monitoring_people
 union all select 'monitoring_bindings',count(*) from public.monitoring_bindings
 union all select 'monitoring_photos',count(*) from public.monitoring_photos
 union all select 'monitoring_settings',count(*) from public.monitoring_settings
 union all select 'monitoring_results',count(*) from public.monitoring_results
 union all select 'monitoring_jobs',count(*) from public.monitoring_jobs
 union all select 'monitoring_audit',count(*) from public.monitoring_audit
 union all select 'canonical_catalog',count(*) from private.canonical_catalog
 union all select 'canonical_catalog_alias',count(*) from private.canonical_catalog_alias
 union all select 'employee_catalog_legacy',count(*) from private.employee_catalog_legacy
 union all select 'planning_configurations',count(*) from private.planning_configurations
 union all select 'operational_import_batches',count(*) from private.operational_import_batches
 union all select 'daily_call_attachments',count(*) from private.daily_call_attachments
), expected_functions(signature,access_class) as (values
 ('public.administration(text,text,jsonb)','authenticated'),
 ('public.workspace(text,jsonb)','authenticated'),
 ('public.daily_call_batch(text,jsonb)','authenticated'),
 ('public.daily_call_attachments(text,jsonb)','authenticated'),
 ('public.daily_call_attachment_upload(uuid,jsonb)','service'),
 ('public.monitoring_binding_change(text,jsonb)','authenticated'),
 ('public.monitoring_sources_admin(text,jsonb)','authenticated'),
 ('public.monitoring_worker_sources(text[])','service'),
 ('public.operational_import(text,jsonb)','authenticated'),
 ('public.audit_history(jsonb)','authenticated'),
 ('public.schedule_planning(text,jsonb)','authenticated'),
 ('public.monitoring_ingest(jsonb)','service'),
 ('public.monitoring_worker(text,jsonb)','service'),
 ('private.monitoring_ingest_impl(jsonb)','service'),
 ('private.monitoring_worker_impl(text,jsonb)','service'),
 ('private.monitoring_worker_sources_impl(text[])','service'),
 ('private.daily_call_attachment_upload(uuid,jsonb)','service'),
 ('private.monitoring_ingest_before_source_management(jsonb)','internal'),
 ('private.workspace_before_operations(text,jsonb)','internal'),
 ('private.daily_call_attachment_internal(text,jsonb,uuid,boolean)','internal'),
 ('private.operational_import_snapshot(uuid)','internal')
), functions as (
 select e.signature,e.access_class,p.oid is not null present,n.nspname schema,p.proname function,p.prosecdef security_definer,
 has_function_privilege('anon',p.oid,'execute') anonymous_execute,
 has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
 has_function_privilege('service_role',p.oid,'execute') service_execute
 from expected_functions e left join pg_proc p on p.oid=to_regprocedure(e.signature)
 left join pg_namespace n on n.oid=p.pronamespace order by e.signature
), expected_tables(relation) as (values
 ('private.canonical_catalog'),('private.canonical_catalog_alias'),('private.employee_catalog_legacy'),
 ('private.daily_call_attachments'),('private.daily_call_attachment_audit'),
 ('private.operational_import_batches'),('private.operational_import_rows'),('private.planning_configurations'),
 ('private.monitoring_revision'),('public.monitoring_sources'),('public.monitoring_files'),
 ('public.monitoring_batches'),('public.monitoring_attempts'),('public.monitoring_events'),
 ('public.monitoring_occurrences'),('public.monitoring_people'),('public.monitoring_bindings'),
 ('public.monitoring_settings'),('public.monitoring_photos'),('public.monitoring_results'),
 ('public.monitoring_jobs'),('public.monitoring_audit')
), tables as (
 select e.relation,c.oid is not null present,n.nspname schema,c.relname table,c.relrowsecurity rls,
 (has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate,references,trigger') or has_any_column_privilege('anon',c.oid,'select,insert,update,references')) anonymous_access,
 (has_table_privilege('authenticated',c.oid,'select,insert,update,delete,truncate,references,trigger') or has_any_column_privilege('authenticated',c.oid,'select,insert,update,references')) authenticated_direct_access,
 (has_table_privilege('service_role',c.oid,'select,insert,update,delete,truncate,references,trigger') or has_any_column_privilege('service_role',c.oid,'select,insert,update,references')) service_direct_access
 from expected_tables e left join pg_class c on c.oid=to_regclass(e.relation) and c.relkind='r'
 left join pg_namespace n on n.oid=c.relnamespace order by e.relation
), photo_bytes as (
 select p.*,case when length(base64)>0 and base64 ~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
 then decode(base64,'base64') end bytes from public.monitoring_photos p
), photo_quality as (
 select count(*) total,count(*) filter(where bytes is null) invalid_base64,
 count(*) filter(where bytes is not null and (octet_length(bytes)=0 or octet_length(bytes)>2097152)) invalid_size,
 count(*) filter(where bytes is not null and encode(sha256(bytes),'hex')<>sha256) hash_mismatch,
 coalesce(sum(octet_length(bytes)),0) total_bytes,
 count(*) filter(where not exists(select 1 from public.monitoring_people p where p.source_id=b.source_id and p.external_id=b.identity_value)) without_person
 from photo_bytes b
), catalog_preservation as (
 select count(*) employees,
 count(*) filter(where l.employee_id is null) missing_legacy_snapshot,
 count(*) filter(where l.department is not null and btrim(l.department)<>'' and not exists(select 1 from private.canonical_catalog_alias a where a.kind='department' and a.label=l.department)) missing_department_alias,
 count(*) filter(where l.job is not null and btrim(l.job)<>'' and not exists(select 1 from private.canonical_catalog_alias a where a.kind='job' and a.label=l.job)) missing_job_alias,
 count(*) filter(where l.category is not null and btrim(l.category)<>'' and not exists(select 1 from private.canonical_catalog_alias a where a.kind='category' and a.label=l.category)) missing_category_alias
 from public.colaboradores c left join private.employee_catalog_legacy l on l.employee_id=c.id
)
select jsonb_build_object('captured_at',now(),'migration_count',(select count(*) from supabase_migrations.schema_migrations),
 'last_migration',(select max(version) from supabase_migrations.schema_migrations),
 'counts',(select jsonb_object_agg(dataset,total) from counts),
 'file_status',(select coalesce(jsonb_object_agg(status,total),'{}'::jsonb) from (select status,count(*) total from public.monitoring_files group by status) s),
 'photo_quality',(select to_jsonb(q) from photo_quality q),'catalog_preservation',(select to_jsonb(c) from catalog_preservation c),
 'functions',(select jsonb_agg(to_jsonb(f)) from functions f),'tables',(select jsonb_agg(to_jsonb(t)) from tables t)) as complementary_audit;
