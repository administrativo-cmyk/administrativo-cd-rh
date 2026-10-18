-- Disposable synthetic fixtures only. Ends in rollback; no production data required.
begin;
insert into auth.users(id,email,raw_user_meta_data)
select ('ad000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 encode(sha256(convert_to('88888888'||lpad(i::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',
 jsonb_build_object('nome_completo','Admin test '||i,'cpf_normalizado','88888888'||lpad(i::text,3,'0')) from generate_series(1,7) i;
insert into public.gestores(id,nome) values ('ae000000-0000-4000-8000-000000000001','Equipe teste A'),('ae000000-0000-4000-8000-000000000002','Equipe teste B');
update public.perfis set status_usuario='APROVADO',papel_usuario=case right(id::text,1) when '1' then 'ADMIN'::public.papel_usuario when '2' then 'RH'::public.papel_usuario when '4' then 'LEITURA'::public.papel_usuario else 'GESTOR'::public.papel_usuario end,
 gestor_id=case right(id::text,1) when '3' then 'ae000000-0000-4000-8000-000000000001'::uuid when '7' then 'ae000000-0000-4000-8000-000000000002'::uuid end,aprovado_em=now()
 where id::text like 'ad000000-%' and right(id::text,1)<>'5';
update public.perfis set status_usuario='BLOQUEADO',bloqueado_em=now(),bloqueado_por='ad000000-0000-4000-8000-000000000001' where id='ad000000-0000-4000-8000-000000000006';
insert into public.colaboradores(id,matricula,nome,unidade_id,gestor_id) values
 ('ac000000-0000-4000-8000-000000000001','ADMIN-TEST-A','Pessoa teste A',(select id from public.unidades where codigo='CD I'),'ae000000-0000-4000-8000-000000000001'),
 ('ac000000-0000-4000-8000-000000000002','ADMIN-TEST-B','Pessoa teste B',(select id from public.unidades where codigo='CD I'),'ae000000-0000-4000-8000-000000000002');

insert into public.monitoring_results(employee_id,operational_date,input_version,rule_version,result,summary,reason)
select id,'2026-10-01',1,'synthetic','{}','{}','Synthetic register regression' from public.colaboradores where id::text like 'ac000000-%';

create function pg_temp.admin_assert(condition boolean,label text) returns void language plpgsql as $$ begin if condition is distinct from true then raise exception 'Assertion failed: %',label; end if; end $$;
create function pg_temp.admin_reject(entity text,action text,data jsonb,expected text) returns void language plpgsql as $$
begin
 begin perform public.administration(entity,action,data); exception when others then if position(expected in sqlerrm)>0 then return; else raise; end if; end;
 raise exception 'Expected rejection: %',expected;
end $$;

select pg_temp.admin_assert(not has_function_privilege('anon','public.administration(text,text,jsonb)','execute'),'anonymous RPC denied');
select pg_temp.admin_assert(not has_table_privilege('authenticated','public.ferias_planejamento','insert'),'raw planning insert denied');
select pg_temp.admin_assert(not has_table_privilege('authenticated','private.administration_audit','select'),'raw audit denied');
select pg_temp.admin_assert((select relrowsecurity from pg_class where oid='public.ferias_planejamento'::regclass),'planning RLS enabled');
select pg_temp.admin_assert((select relrowsecurity from pg_class where oid='private.administration_audit'::regclass),'audit RLS enabled');

set local role authenticated;
select set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000001',true);
do $$
declare u jsonb; m jsonb; e jsonb; old_stamp text; vacation jsonb; other_vacation jsonb; approved jsonb; n bigint; snapshot jsonb;
begin
 u:=public.administration('unit','save','{"code":"  TEST-CD  ","name":"Unidade teste","reason":"Cadastro sintético"}')->'record';
 perform pg_temp.admin_assert(u->>'code'='TEST-CD','unit trimmed');
 perform pg_temp.admin_reject('unit','save','{"code":"test-cd","name":"Duplicada","reason":"Cadastro sintético"}','ADMINISTRATION_DUPLICATE');
 snapshot:=public.administration('unit','list','{"limit":1,"offset":0}');
 perform pg_temp.admin_assert(snapshot->>'datasetVersion'=public.administration('unit','list','{"limit":1,"offset":1}')->>'datasetVersion','dataset version independent of pagination');
 old_stamp:=u->>'updatedAt';
 u:=public.administration('unit','save',jsonb_build_object('id',u->>'id','expectedUpdatedAt',old_stamp,'code','TEST-CD','name','Unidade atualizada','reason','Correção sintética'))->'record';
 perform pg_temp.admin_assert((u->>'updatedAt')::timestamptz>old_stamp::timestamptz,'version advances within transaction');
 perform pg_temp.admin_assert(snapshot->>'datasetVersion'<>public.administration('unit','list','{"limit":1,"offset":0}')->>'datasetVersion','dataset version changes with register edit');
 perform pg_temp.admin_reject('unit','save',jsonb_build_object('id',u->>'id','expectedUpdatedAt',old_stamp,'code','TEST-CD','name','Versão velha','reason','Correção sintética'),'ADMINISTRATION_STALE');
 m:=public.administration('manager','save',jsonb_build_object('name','Gestor novo','referenceUnitId',u->>'id','reason','Cadastro sintético'))->'record';
 perform pg_temp.admin_reject('unit','archive',jsonb_build_object('id',u->>'id','expectedUpdatedAt',u->>'updatedAt','reason','Teste referência'),'ADMINISTRATION_REFERENCED');
 e:=public.administration('employee','save',jsonb_build_object('employeeNumber','0000123','name','Pessoa nova','unitId',u->>'id','managerId',m->>'id','situation','ATIVO','workdayHours',8,'reason','Cadastro sintético'))->'record';
 perform pg_temp.admin_assert(e->>'employeeNumber'='0000123','employee number preserves zeros');
 perform pg_temp.admin_reject('manager','archive',jsonb_build_object('id',m->>'id','expectedUpdatedAt',m->>'updatedAt','reason','Teste referência'),'ADMINISTRATION_REFERENCED');
 perform pg_temp.admin_reject('employee','save',jsonb_build_object('employeeNumber','0000123','name','Duplicada','unitId',u->>'id','situation','ATIVO','workdayHours',8,'reason','Cadastro sintético'),'ADMINISTRATION_DUPLICATE');
 perform pg_temp.admin_reject('employee','save',jsonb_build_object('employeeNumber','INVALID-HOURS','name','Invalido','unitId',u->>'id','situation','ATIVO','workdayHours',0,'reason','Cadastro sintético'),'ADMINISTRATION_INVALID_INPUT');
 perform pg_temp.admin_reject('employee','save',jsonb_build_object('employeeNumber','INVALID-REF','name','Invalido','unitId','ffffffff-0000-4000-8000-000000000000','situation','ATIVO','workdayHours',8,'reason','Cadastro sintético'),'ADMINISTRATION_INACTIVE_REFERENCE');
 e:=public.administration('employee','archive',jsonb_build_object('id',e->>'id','expectedUpdatedAt',e->>'updatedAt','reason','Arquivamento teste'))->'record';
 perform pg_temp.admin_assert((e->>'activeInSystem')::boolean=false,'employee archived');
 m:=public.administration('manager','archive',jsonb_build_object('id',m->>'id','expectedUpdatedAt',m->>'updatedAt','reason','Arquivamento teste'))->'record';
 perform pg_temp.admin_reject('employee','restore',jsonb_build_object('id',e->>'id','expectedUpdatedAt',e->>'updatedAt','reason','Restauração teste'),'ADMINISTRATION_INACTIVE_REFERENCE');
 m:=public.administration('manager','restore',jsonb_build_object('id',m->>'id','expectedUpdatedAt',m->>'updatedAt','reason','Restauração teste'))->'record';
 e:=public.administration('employee','restore',jsonb_build_object('id',e->>'id','expectedUpdatedAt',e->>'updatedAt','reason','Restauração teste'))->'record';
 perform pg_temp.admin_assert((e->>'activeInSystem')::boolean,'employee restored');
 snapshot:=public.administration('employee','list','{"query":"0000123"}');
 perform pg_temp.admin_assert((snapshot->>'total')::integer=1,'registered list searches exact zero-preserved value');

 perform set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000003',true);
 perform pg_temp.admin_reject('unit','list','{}','ADMINISTRATION_FORBIDDEN');
 perform pg_temp.admin_reject('employee','save','{"reason":"Tentativa gestor"}','ADMINISTRATION_FORBIDDEN');
 perform pg_temp.admin_reject('vacation','save','{"employeeId":"ac000000-0000-4000-8000-000000000002","startDate":"2027-01-01","endDate":"2027-01-10","status":"draft","reason":"Proposta teste"}','ADMINISTRATION_FORBIDDEN');
 perform pg_temp.admin_reject('vacation','save','{"employeeId":"ac000000-0000-4000-8000-000000000001","startDate":"2027-01-01","endDate":"2027-01-10","status":"approved","reason":"Proposta teste"}','ADMINISTRATION_VACATION_LOCKED');
 vacation:=public.administration('vacation','save','{"employeeId":"ac000000-0000-4000-8000-000000000001","acquisitionStart":"2026-01-01","acquisitionEnd":"2026-12-31","startDate":"2027-01-01","endDate":"2027-01-10","status":"draft","reason":"Proposta teste"}')->'record';
 vacation:=public.administration('vacation','save',(vacation-'id'-'updatedAt'-'createdAt'-'createdBy'-'approvedBy'-'approvedAt'-'archivedAt'-'employeeName'-'employeeNumber'-'managerId'-'unitId'-'canEdit')||jsonb_build_object('id',vacation->>'id','expectedUpdatedAt',vacation->>'updatedAt','status','requested','reason','Solicitação teste'))->'record';
 perform pg_temp.admin_assert(vacation->>'status'='requested','manager requests own plan');
 perform set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000007',true);
 perform pg_temp.admin_reject('vacation','archive',jsonb_build_object('id',vacation->>'id','expectedUpdatedAt',vacation->>'updatedAt','reason','Outro gestor teste'),'ADMINISTRATION_FORBIDDEN');
 perform pg_temp.admin_assert((public.administration('vacation','list','{}')->>'total')::integer=0,'other team not listed');

 perform set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000002',true);
 approved:=public.administration('vacation','save',jsonb_build_object('id',vacation->>'id','expectedUpdatedAt',vacation->>'updatedAt','employeeId','ac000000-0000-4000-8000-000000000001','startDate','2027-01-01','endDate','2027-01-10','status','approved','reason','Aprovação sintética'))->'record';
 perform pg_temp.admin_assert(approved->>'approvedBy'='ad000000-0000-4000-8000-000000000002','RH approval actor recorded');
 perform pg_temp.admin_reject('vacation','save','{"employeeId":"ac000000-0000-4000-8000-000000000001","startDate":"2027-01-10","endDate":"2027-01-20","status":"approved","reason":"Sobreposição teste"}','ADMINISTRATION_VACATION_OVERLAP');
 perform pg_temp.admin_reject('vacation','save','{"employeeId":"ac000000-0000-4000-8000-000000000001","startDate":"2027-02-10","endDate":"2027-02-01","status":"draft","reason":"Datas inválidas"}','ADMINISTRATION_INVALID_INPUT');
 perform pg_temp.admin_reject('vacation','save','{"employeeId":"ac000000-0000-4000-8000-000000000001","acquisitionStart":"2026-01-01","startDate":"2027-02-01","endDate":"2027-02-10","status":"draft","reason":"Aquisitivo parcial"}','ADMINISTRATION_INVALID_INPUT');
 other_vacation:=public.administration('vacation','save','{"employeeId":"ac000000-0000-4000-8000-000000000002","startDate":"2027-01-01","endDate":"2027-01-10","status":"approved","reason":"Outra equipe teste"}')->'record';
 perform set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000003',true);
 perform pg_temp.admin_reject('vacation','archive',jsonb_build_object('id',approved->>'id','expectedUpdatedAt',approved->>'updatedAt','reason','Gestor não aprova'),'ADMINISTRATION_FORBIDDEN');
 perform pg_temp.admin_assert((public.administration('vacation','list','{}')->>'total')::integer=1,'manager list is team scoped');
 perform set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000004',true);
 perform pg_temp.admin_assert((public.administration('vacation','list','{}')->>'total')::integer=2,'reader can read plans');
 perform pg_temp.admin_reject('vacation','save','{"reason":"Leitura não altera"}','ADMINISTRATION_FORBIDDEN');
 perform set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000005',true);
 perform pg_temp.admin_reject('vacation','list','{}','ADMINISTRATION_FORBIDDEN');
 perform set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000006',true);
 perform pg_temp.admin_reject('vacation','list','{}','ADMINISTRATION_FORBIDDEN');
 perform set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000001',true);
 approved:=public.administration('vacation','archive',jsonb_build_object('id',approved->>'id','expectedUpdatedAt',approved->>'updatedAt','reason','Arquivar plano teste'))->'record';
 perform pg_temp.admin_assert(approved->>'archivedAt' is not null,'vacation archived without deletion');
 approved:=public.administration('vacation','restore',jsonb_build_object('id',approved->>'id','expectedUpdatedAt',approved->>'updatedAt','reason','Restaurar plano teste'))->'record';
 perform pg_temp.admin_assert(approved->>'archivedAt' is null,'vacation restored');
 e:=public.administration('employee','list','{"employeeId":"ac000000-0000-4000-8000-000000000001"}')->'rows'->0;
 perform public.administration('employee','save',(e-'id'-'createdAt'-'updatedAt'-'activeInSystem')||jsonb_build_object('id',e->>'id','expectedUpdatedAt',e->>'updatedAt','name','Pessoa teste A revisada','reason','Revisão sintética'));
end $$;
reset role;
select pg_temp.admin_assert((select dirty from public.monitoring_results where employee_id='ac000000-0000-4000-8000-000000000001'),'employee edit invalidates its clean result');
select pg_temp.admin_assert((select count(*) from public.monitoring_jobs where employee_id='ac000000-0000-4000-8000-000000000001' and operational_date='2026-10-01')=1,'clean result without events is enqueued');
select pg_temp.admin_assert(not(select dirty from public.monitoring_results where employee_id='ac000000-0000-4000-8000-000000000002'),'unit and manager metadata preserve unrelated clean result');
select pg_temp.admin_assert((select count(*) from public.monitoring_jobs where employee_id='ac000000-0000-4000-8000-000000000002')=0,'metadata changes do not create unrelated jobs');
select pg_temp.admin_assert((select count(*) from public.chamada_diaria where colaborador_id::text like 'ac000000-%')=0,'approval never writes attendance');
select pg_temp.admin_assert((select count(*) from public.banco_horas_medicoes where colaborador_id::text like 'ac000000-%')=0,'approval never writes financial balances');
select pg_temp.admin_assert((select count(*) from private.administration_audit where actor::text like 'ad000000-%')>=12,'successful changes audited');
select pg_temp.admin_assert((select count(*) from public.colaboradores where matricula='0000123')=1,'archive preserves employee identity');
rollback;
