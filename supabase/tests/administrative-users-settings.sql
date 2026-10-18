-- Synthetic identities only; isolated execution always rolls back.
begin;
insert into auth.users(id,email,raw_user_meta_data)
select ('bd000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 encode(sha256(convert_to('77777777'||lpad(i::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',
 jsonb_build_object('nome_completo','Access test '||i,'cpf_normalizado','77777777'||lpad(i::text,3,'0')) from generate_series(1,5) i;
insert into public.gestores(id,nome) values ('be000000-0000-4000-8000-000000000001','Synthetic manager');
update public.perfis set status_usuario='APROVADO',papel_usuario=case right(id::text,1) when '1' then 'ADMIN'::public.papel_usuario when '2' then 'RH'::public.papel_usuario when '3' then 'GESTOR'::public.papel_usuario else 'LEITURA'::public.papel_usuario end,
 gestor_id=case right(id::text,1) when '3' then 'be000000-0000-4000-8000-000000000001'::uuid end,aprovado_em=now()
 where id::text like 'bd000000-%' and right(id::text,1)<>'5';
insert into public.colaboradores(id,matricula,nome,unidade_id) values ('bc000000-0000-4000-8000-000000000001','VERSION-TEST','Synthetic employee',(select id from public.unidades where codigo='CD I'));
insert into public.monitoring_results(employee_id,operational_date,input_version,rule_version,result,summary,reason)
values ('bc000000-0000-4000-8000-000000000001','2026-10-01',1,'synthetic','{}','{}','Synthetic revision regression');
create function pg_temp.version_assert(condition boolean,label text) returns void language plpgsql as $$ begin if condition is distinct from true then raise exception 'Assertion failed: %',label; end if; end $$;
create function pg_temp.version_reject(domain text,action text,data jsonb,expected text) returns void language plpgsql as $$
begin
 begin
  if domain='user' then perform public.administration_users(action,data); else perform public.monitoring_setting_change(action,data); end if;
 exception when others then if position(expected in sqlerrm)>0 then return; else raise; end if; end;
 raise exception 'Expected rejection: %',expected;
end $$;
create function pg_temp.version_user(id uuid) returns jsonb language sql as $$ select u from jsonb_array_elements(public.administration_users('list','{}')) u where u->>'id'=id::text $$;
create function pg_temp.version_setting(id uuid) returns jsonb language sql as $$ select s from jsonb_array_elements(public.monitoring_query('admin','{}')->'settings') s where s->>'id'=id::text $$;
select pg_temp.version_assert(not has_function_privilege('anon','public.administration_users(text,jsonb)','execute'),'anonymous user edit denied');
select pg_temp.version_assert(not has_function_privilege('anon','public.monitoring_setting_change(text,jsonb)','execute'),'anonymous setting edit denied');
select pg_temp.version_assert(not has_table_privilege('authenticated','private.user_edit_audit','select'),'raw audit denied');
select pg_temp.version_assert((select relrowsecurity from pg_class where oid='private.user_edit_audit'::regclass),'audit RLS enabled');
set local role authenticated;
select set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000001',true);
do $$ declare u jsonb; data jsonb; result jsonb; setting jsonb; newer jsonb; config jsonb; overlap jsonb; original_id uuid; stamp text;
begin
 u:=pg_temp.version_user('bd000000-0000-4000-8000-000000000001');
 data:=jsonb_build_object('id',u->>'id','name','Admin revised','role','LEITURA','managerId',null,'expectedUpdatedAt',u->>'updated_at','reason','Synthetic role revision');
 perform pg_temp.version_reject('user','save',data,'USER_EDIT_LAST_ADMIN');
 u:=pg_temp.version_user('bd000000-0000-4000-8000-000000000004');
 data:=jsonb_build_object('id',u->>'id','name','Reader revised','role','GESTOR','managerId','be000000-0000-4000-8000-000000000001','expectedUpdatedAt',u->>'updated_at','reason','Synthetic team revision');
 result:=public.administration_users('save',data);
 perform pg_temp.version_assert((result->>'updatedAt')::timestamptz>(u->>'updated_at')::timestamptz,'user version advances');
 perform pg_temp.version_reject('user','save',data,'USER_EDIT_STALE');
 perform pg_temp.version_reject('user','save',data||jsonb_build_object('expectedUpdatedAt',result->>'updatedAt','managerId',null),'USER_EDIT_MANAGER_REQUIRED');
 u:=pg_temp.version_user('bd000000-0000-4000-8000-000000000005');
 perform pg_temp.version_reject('user','save',data||jsonb_build_object('id',u->>'id','expectedUpdatedAt',u->>'updated_at'),'USER_EDIT_PENDING');
 perform set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000002',true);
 u:=pg_temp.version_user('bd000000-0000-4000-8000-000000000001');
 perform pg_temp.version_reject('user','save',data||jsonb_build_object('id',u->>'id','expectedUpdatedAt',u->>'updated_at'),'USER_EDIT_FORBIDDEN');
 u:=pg_temp.version_user('bd000000-0000-4000-8000-000000000004');
 data:=data||jsonb_build_object('expectedUpdatedAt',u->>'updated_at');
 perform pg_temp.version_reject('user','save',data||'{"role":"ADMIN","managerId":null}','USER_EDIT_FORBIDDEN');
 perform public.administration_users('save',data||'{"role":"LEITURA","managerId":null}');
 perform set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000003',true);
 perform pg_temp.version_reject('user','list','{}','USER_EDIT_FORBIDDEN');
 perform pg_temp.version_reject('setting','restore','{}','SETTING_FORBIDDEN');
 perform set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000001',true);

 config:='{"kind":"schedule","target":"bc000000-0000-4000-8000-000000000001","validFrom":"2026-10-01","validTo":"2026-10-10","reason":"Synthetic schedule","payload":{"name":"Test schedule","start":"08:00","end":"17:00","days":[1,2,3,4,5],"pairing":"explicit","allowNoBreak":false,"coffeeWindows":[{"start":"09:00","end":"09:15"},{"start":"15:00","end":"15:15"}]}}';
 begin perform public.monitoring_query('setting',jsonb_set(config,'{payload,start}','"25:00"')); raise exception 'Invalid creation persisted'; exception when raise_exception then if sqlerrm<>'SETTING_INVALID_INPUT' then raise; end if; end;
 result:=public.monitoring_query('setting',config); original_id:=(result->>'id')::uuid;
 setting:=pg_temp.version_setting(original_id); stamp:=setting->>'updated_at';
 perform pg_temp.version_reject('setting','replace',jsonb_build_object('id',original_id,'reason','Synthetic revision','setting',config),'SETTING_VERSION_REQUIRED');
 data:=jsonb_build_object('id',original_id,'expectedUpdatedAt',stamp,'reason','Synthetic revision','setting',jsonb_set(config,'{payload,start}','"07:00"'));
 result:=public.monitoring_setting_change('replace',data);
 newer:=pg_temp.version_setting((result->>'id')::uuid);
 perform pg_temp.version_assert(newer->>'supersedes_id'=original_id::text and (newer->>'revision')::integer=2,'replacement linked and versioned');
 setting:=pg_temp.version_setting(original_id);
 perform pg_temp.version_assert(setting->>'revoked_at' is not null and setting#>>'{payload,start}'='08:00','old payload retained');
 perform pg_temp.version_reject('setting','replace',data,'SETTING_STALE');
 perform pg_temp.version_reject('setting','restore',jsonb_build_object('id',original_id,'expectedUpdatedAt',setting->>'updated_at','reason','Synthetic restore'),'SETTING_SUPERSEDED');
 -- Conflict and invalid payload roll back the revoke and new revision together.
 overlap:=public.monitoring_query('setting',config||'{"validFrom":"2026-10-11","validTo":"2026-10-20"}');
 data:=jsonb_build_object('id',newer->>'id','expectedUpdatedAt',newer->>'updated_at','reason','Conflicting revision','setting',config||'{"validTo":"2026-10-15"}');
 perform pg_temp.version_reject('setting','replace',data,'SETTING_VALIDITY_CONFLICT');
 perform pg_temp.version_assert(pg_temp.version_setting((newer->>'id')::uuid)->>'revoked_at' is null,'conflict preserves current revision');
 perform pg_temp.version_reject('setting','replace',jsonb_set(data,'{setting,payload,start}','"25:00"'),'SETTING_INVALID_INPUT');
 perform pg_temp.version_reject('setting','replace',jsonb_set(data,'{setting,target}','"bc000000-0000-4000-8000-000000000002"'),'SETTING_TARGET_IMMUTABLE');
 perform public.monitoring_setting_change('revoke',jsonb_build_object('id',newer->>'id','expectedUpdatedAt',newer->>'updated_at','reason','Synthetic removal'));
 newer:=pg_temp.version_setting((newer->>'id')::uuid);
 result:=public.monitoring_setting_change('restore',jsonb_build_object('id',newer->>'id','expectedUpdatedAt',newer->>'updated_at','reason','Synthetic restoration'));
 setting:=pg_temp.version_setting((result->>'id')::uuid);
 perform pg_temp.version_assert((setting->>'revision')::integer=3 and setting->>'supersedes_id'=newer->>'id' and setting->>'revoked_at' is null,'restore creates next immutable revision');
end $$;
reset role;
select pg_temp.version_assert((select count(*) from private.user_edit_audit where actor::text like 'bd000000-%')=2,'only successful user edits audited');
select pg_temp.version_assert((select count(*) from public.monitoring_audit where action in ('replace_setting','revoke_setting','restore_setting') and actor::text like 'bd000000-%')=3,'version mutations audited');
select pg_temp.version_assert((select count(*) from public.monitoring_jobs where employee_id='bc000000-0000-4000-8000-000000000001' and operational_date='2026-10-01')=1,'revised historical result enqueued');
select pg_temp.version_assert((select count(*) from public.chamada_diaria where colaborador_id='bc000000-0000-4000-8000-000000000001')=0,'configuration does not write attendance');
select pg_temp.version_assert((select count(*) from public.banco_horas_medicoes where colaborador_id='bc000000-0000-4000-8000-000000000001')=0,'configuration does not write balance');
rollback;
