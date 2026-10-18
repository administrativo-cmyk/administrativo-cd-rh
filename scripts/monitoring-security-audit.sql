-- Read-only post-activation security receipt; contains no user data.
with module_tables as (
  select c.oid,n.nspname,c.relname,c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and
    ((n.nspname='public' and c.relname like 'monitoring\_%' escape '\')
     or (n.nspname='private' and c.relname like 'daily\_call\_%' escape '\'))
), module_functions as (
  select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and
    (p.proname like 'monitoring\_%' escape '\' or p.proname like 'daily\_call\_%' escape '\')
)
select jsonb_build_object(
  'migrations',(select count(*) from supabase_migrations.schema_migrations),
  'module_tables',(select count(*) from module_tables),
  'tables_without_rls',(select count(*) from module_tables where not relrowsecurity),
  'raw_browser_grants',(select count(*) from module_tables t cross join pg_roles r
    where r.rolname in ('anon','authenticated') and
    (has_table_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_any_column_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE'))),
  'anonymous_rpc_grants',(select count(*) from module_functions where nspname='public' and has_function_privilege('anon',oid,'EXECUTE')),
  'worker_rpc_browser_grants',(select count(*) from module_functions where nspname='public'
    and proname in ('monitoring_ingest','monitoring_save_result','monitoring_worker','daily_call_apply_import')
    and has_function_privilege('authenticated',oid,'EXECUTE')),
  'definers_without_empty_search_path',(select count(*) from module_functions where prosecdef
    and not(coalesce(proconfig,'{}') && array['search_path=""','search_path='])),
  'invalid_module_indexes',(select count(*) from pg_index i join module_tables t on t.oid=i.indrelid where not indisvalid or not indisready),
  'disabled_daily_call_triggers',(select count(*) from pg_trigger where not tgisinternal and tgname like 'daily\_call\_%' escape '\' and tgenabled='D')
) as monitoring_security_audit;
