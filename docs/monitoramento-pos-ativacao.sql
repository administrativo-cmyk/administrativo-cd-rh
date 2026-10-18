-- Verificacao POS-ATIVACAO: somente leitura. Nao instala, importa nem altera Auth.
-- Executar por bloco no SQL Editor do projeto administrativo-cd-rh confirmado.
-- SQL Editor costuma executar como postgres e auth.uid() costuma ser NULL.
-- Isso verifica estrutura/privilegios, mas NAO substitui teste com a sessao real.

-- 1. Destino/contexto: nao retorna URL, chaves ou credenciais.
select current_database() as database_name,current_user as execution_role,
  current_setting('server_version') as postgres_version,
  current_setting('TimeZone') as session_timezone,auth.uid() as request_actor;

-- 2. Exatamente as 22 versoes locais. Esperado: 22 presentes, 0 faltantes/extra.
with expected(version) as (values
 ('20260923204012'),('20260923204014'),('20260923204015'),('20260923204017'),
 ('20260924143652'),('20260924195656'),('20260925112752'),('20260925120000'),
 ('20260925190000'),('20260925200000'),('20260928192834'),('20261005175821'),
 ('20261006184741'),('20261006193033'),('20261007140655'),('20261008121650'),
 ('20261008132607'),('20261017165920'),('20261017165932'),('20261017175455'),('20261017175802'),('20261017185924'))
select coalesce(e.version,m.version) as version,
 case when e.version is null then 'EXTRA' when m.version is null then 'MISSING' else 'PRESENT' end as state
from expected e full join supabase_migrations.schema_migrations m on m.version=e.version
order by version;

-- 3. RLS e acesso efetivo bruto, incluindo privilegios herdados de PUBLIC.
-- Esperado: tabelas public.monitoring_* e private.daily_call_* com RLS=true;
-- anon/authenticated sem SELECT/INSERT/UPDATE/DELETE/TRUNCATE e sem acesso por coluna.
-- private.monitoring_revision nao e exposta; sua RLS=false, isoladamente, nao e falha.
select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls,
 r.rolname as role_name,
 has_table_privilege(r.oid,c.oid,'SELECT') as table_select,
 has_table_privilege(r.oid,c.oid,'INSERT') as table_insert,
 has_table_privilege(r.oid,c.oid,'UPDATE') as table_update,
 has_table_privilege(r.oid,c.oid,'DELETE') as table_delete,
 has_table_privilege(r.oid,c.oid,'TRUNCATE') as table_truncate,
 has_any_column_privilege(r.oid,c.oid,'SELECT') as column_select,
 has_any_column_privilege(r.oid,c.oid,'INSERT') as column_insert,
 has_any_column_privilege(r.oid,c.oid,'UPDATE') as column_update
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join pg_roles r
where c.relkind in ('r','p') and r.rolname in ('anon','authenticated')
 and ((n.nspname='public' and c.relname like 'monitoring\_%' escape '\')
   or (n.nspname='private' and (c.relname like 'monitoring\_%' escape '\' or c.relname like 'daily\_call\_%' escape '\')))
order by n.nspname,c.relname,r.rolname;

-- 4. Matriz de RPCs. existence=true; anon=false em todas.
-- Browser RPCs: authenticated=true. Service RPCs: authenticated=false,service=true.
with expected(signature,kind) as (values
 ('public.monitoring_query(text,jsonb)','browser'),
 ('public.monitoring_identity_photo(text,text)','browser'),
 ('public.daily_call_workflow(text,jsonb)','browser'),
 ('public.ler_chamada_diaria(date,date,date)','browser'),
 ('public.ler_banco_horas_atual(date)','browser'),
 ('public.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamp with time zone)','browser'),
 ('public.monitoring_ingest(jsonb)','service'),
 ('public.monitoring_save_result(jsonb)','service'),
 ('public.monitoring_worker(text,jsonb)','service'),
 ('public.daily_call_apply_import(jsonb)','service'))
select e.signature,e.kind,p.oid is not null as existence,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
 p.prosecdef as security_definer,p.proconfig as function_settings
from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
order by e.kind,e.signature;

-- 5. Helpers antigos e internos NAO devem ser executaveis por anon/authenticated.
-- Implementacoes de RPC aprovadas podem ter authenticated=true; filtro abaixo
-- cobre somente helpers internos/renomeados, nao as implementacoes publicadas.
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 p.prosecdef as security_definer,p.proconfig as function_settings
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('private','chamada_privada') and (
 p.proname like '%before%'
 or p.proname in ('monitoring_input','monitoring_enqueue','monitoring_can_read',
 'daily_call_rows','daily_call_evidence','daily_call_change','daily_call_source_ready',
 'daily_call_source_failure','daily_call_baseline_changed'))
order by n.nspname,p.proname;

-- 6. Definers do modulo precisam search_path vazio definido explicitamente.
-- Resultado vazio esperado. Revisar qualquer linha; nao executar correcoes aqui.
select n.nspname,p.proname,p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private','chamada_privada') and p.prosecdef
 and (p.proname like 'monitoring\_%' escape '\' or p.proname like 'daily\_call\_%' escape '\'
   or p.proname in ('ler_chamada_diaria_impl','salvar_chamada_diaria'))
 and not (coalesce(p.proconfig,'{}') && array['search_path=""','search_path=']);

-- 7. Presenca das ligacoes atomicas e triggers. Os 3 booleanos devem ser true.
select position('daily_call_apply_import_impl' in pg_get_functiondef(to_regprocedure('private.monitoring_save_result_impl(jsonb)')))>0 as save_syncs_attendance,
 position('private.monitoring_save_result_impl' in pg_get_functiondef(to_regprocedure('private.monitoring_worker_impl(text,jsonb)')))>0 as worker_uses_atomic_save,
 position('chamada_privada.salvar_chamada_diaria' in pg_get_functiondef(to_regprocedure('public.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamp with time zone)')))>0 as editor_uses_guarded_writer;
select n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and t.tgname like 'daily\_call\_%' escape '\'
order by c.relname,t.tgname;

-- 8. Constraints/indices: resultados vazios esperados.
select n.nspname,c.relname,k.conname from pg_constraint k
join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
where not k.convalidated and n.nspname in ('public','private')
 and (c.relname like 'monitoring\_%' escape '\' or c.relname like 'daily\_call\_%' escape '\'
   or c.relname in ('chamada_diaria','chamada_diaria_auditoria','banco_horas_medicoes','colaboradores','lotes_importacao'));
select n.nspname,c.relname as table_name,idx.relname as index_name,i.indisvalid,i.indisready
from pg_index i join pg_class c on c.oid=i.indrelid join pg_class idx on idx.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','private') and (not i.indisvalid or not i.indisready)
 and (c.relname like 'monitoring\_%' escape '\' or c.relname like 'daily\_call\_%' escape '\');

-- 9. Estado de processamento em contagens; nao retorna CPF/PIS, fotos ou payload.
select s.kind,f.status,count(*) as files,sum(f.processed_rows) as processed_rows,
 sum(f.rejected_rows) as rejected_rows,sum(f.conflict_rows) as conflict_rows
from public.monitoring_sources s join public.monitoring_files f on f.source_id=s.id group by s.kind,f.status order by s.kind,f.status;
select event_type,eligible,conflicted,count(*) as events from public.monitoring_events group by event_type,eligible,conflicted;
select mime_type,count(*) as photos from public.monitoring_photos group by mime_type;
select count(*) as pending_jobs,count(*) filter(where leased_until>now()) as leased_jobs,
 count(*) filter(where last_error is not null) as jobs_with_error from public.monitoring_jobs;
select origin,status,count(*) as entries from public.chamada_diaria group by origin,status order by origin,status;

-- 10. Escopo esperado por perfil REAL, sem impersonation/set_config/update.
-- Substituir UUID zero pelo ID da sessao aprovada existente; zero retorna 0 linhas.
-- O resultado e referencia de escopo, NAO prova de autorizacao por JWT.
with actor as (select id,papel_usuario,gestor_id from public.perfis
 where id='00000000-0000-0000-0000-000000000000'::uuid and status_usuario='APROVADO')
select p.papel_usuario,p.gestor_id,count(c.id) as expected_daily_call_employees
from actor p left join public.colaboradores c on c.ativo_no_sistema and c.situacao in ('ATIVO','FERIAS','NOVO_ADMITIDO')
 and (p.papel_usuario in ('ADMIN','RH','LEITURA') or (p.papel_usuario='GESTOR' and p.gestor_id is not null and c.gestor_id=p.gestor_id))
group by p.papel_usuario,p.gestor_id;

-- 11. Benchmark opcional SOMENTE LEITURA de 1 dia com escopo do perfil real.
-- Rodar separado, apos substituir UUID; conta linhas sem retornar pessoas.
-- EXPLAIN ANALYZE executa esta funcao de leitura. Nao executar ANALYZE em RPCs
-- de ingestao, save, worker, resolve ou close. Escalar para 7/31 dias apenas
-- se a consulta de 1 dia terminar dentro do timeout operacional.
explain (analyze,buffers,timing,summary)
select count(*) from public.perfis p
cross join lateral private.daily_call_rows(current_date-1,current_date-1,null,false,p.papel_usuario,p.gestor_id) item
where p.id='00000000-0000-0000-0000-000000000000'::uuid and p.status_usuario='APROVADO'
 and p.papel_usuario in ('ADMIN','RH','GESTOR','LEITURA');
