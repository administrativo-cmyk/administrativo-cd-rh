-- Read-only checks; execute only in administrativo-cd-rh / kqgtnucqxqqgwdyvhvdd.
with counts as (
select 'colaboradores' as dataset,count(*) as total from public.colaboradores
union all select 'banco_horas_medicoes',count(*) from public.banco_horas_medicoes
union all select 'chamada_diaria',count(*) from public.chamada_diaria
union all select 'perfis',count(*) from public.perfis
union all select 'ferias_planejamento',count(*) from public.ferias_planejamento
union all select 'workspace_notices',count(*) from private.workspace_notices
union all select 'banco_horas_medicoes_canceladas',count(*) from public.banco_horas_medicoes where cancelled_at is not null
), functions as (
select n.nspname as schema,p.proname as function,p.prosecdef as security_definer,p.proconfig as settings,
 has_function_privilege('anon',p.oid,'execute') as anonymous_execute,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in ('administration','administration_impl','workspace','workspace_impl','workspace_notifications','administration_users','administration_users_impl','time_bank_admin','time_bank_admin_impl','monitoring_setting_change','monitoring_setting_change_impl')
order by n.nspname,p.proname
), tables as (
select n.nspname as schema,c.relname as table,c.relrowsecurity as rls,
 has_table_privilege('anon',c.oid,'select,insert,update,delete') as any_anonymous_access,
 has_table_privilege('authenticated',c.oid,'insert,update,delete') as authenticated_direct_mutation
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind='r' and (c.relname like 'workspace_%' or c.relname='ferias_planejamento' or c.relname like 'administration_%' or c.relname in ('time_bank_measurement_audit','user_edit_audit'))
order by n.nspname,c.relname
)
select jsonb_build_object(
 'captured_at',now(),
 'migration_count',(select count(*) from supabase_migrations.schema_migrations),
 'last_migration',(select max(version) from supabase_migrations.schema_migrations),
 'counts',(select jsonb_object_agg(dataset,total) from counts),
 'functions',(select jsonb_agg(to_jsonb(f)) from functions f),
 'tables',(select jsonb_agg(to_jsonb(t)) from tables t)
) as system_post_activation_audit;
