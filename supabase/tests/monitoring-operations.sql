-- Synthetic fixture. No real files or remote connection; transaction always rolls back.
begin;
insert into auth.users(id,email,raw_user_meta_data)
select ('ba100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,encode(sha256(convert_to('66666666'||lpad(i::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',jsonb_build_object('nome_completo','Operations test '||i,'cpf_normalizado','66666666'||lpad(i::text,3,'0')) from generate_series(1,3) i;
update public.perfis set status_usuario='APROVADO',papel_usuario=case right(id::text,1) when '1' then 'ADMIN'::public.papel_usuario when '2' then 'RH'::public.papel_usuario else 'LEITURA'::public.papel_usuario end,aprovado_em=now() where id::text like 'ba100000-%';
insert into public.colaboradores(id,matricula,nome,unidade_id) values
 ('ba200000-0000-4000-8000-000000000001','000123','Synthetic One',(select id from public.unidades where codigo='CD I')),
 ('ba200000-0000-4000-8000-000000000002','000124','Synthetic Two',(select id from public.unidades where codigo='CD I'));
insert into public.monitoring_sources(id,kind,identity_namespace) values('synthetic-queued-clock','afd','synthetic-queued-clock');
insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,classification,eligible,nsr,payload)
 values('synthetic-queued-clock','synthetic-punch',repeat('e',64),'punch','cpf','52998224725','2026-10-17T10:00:00Z','authorized',true,'000000001','{}');
create function pg_temp.op_assert(condition boolean,label text) returns void language plpgsql as $$begin if condition is distinct from true then raise exception 'Assertion failed: %',label;end if;end$$;
create function pg_temp.op_reject(domain text,action text,data jsonb,expected text) returns void language plpgsql as $$begin
 begin
  if domain='source' then perform public.monitoring_sources_admin(action,data);elsif domain='binding' then perform public.monitoring_binding_change(action,data);else perform public.operational_import(action,data);end if;
 exception when others then if position(expected in sqlerrm)>0 then return;else raise;end if;end;
 raise exception 'Expected rejection %',expected;
end$$;
select pg_temp.op_assert(not has_function_privilege('anon','public.monitoring_binding_change(text,jsonb)','execute'),'anonymous binding denied');
select pg_temp.op_assert(not has_function_privilege('authenticated','private.monitoring_ingest_before_source_management(jsonb)','execute'),'legacy ingest inaccessible');
select pg_temp.op_assert(not has_table_privilege('authenticated','private.operational_import_rows','select'),'staging raw rows denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000001',true);
do $$declare source jsonb;source_data jsonb;binding jsonb;old_binding jsonb;input jsonb;batch jsonb;newer jsonb;mutation jsonb;begin
 perform public.monitoring_binding_change('create','{"sourceId":"synthetic-queued-clock","identityType":"cpf","identityValue":"52998224725","employeeId":"ba200000-0000-4000-8000-000000000001","validFrom":"2026-10-16","validTo":"2026-10-17","evidence":"Synthetic reviewed event identity"}');
 source_data:='{"id":"synthetic-clock","kind":"afd","timeZone":"America/Sao_Paulo","identityNamespace":"synthetic-clock","label":"Synthetic clock","active":true,"sourceIdentityConfirmed":true,"reason":"Synthetic reviewed source"}';
 source:=public.monitoring_sources_admin('save',source_data)->'record';
 perform pg_temp.op_reject('source','save',source_data,'SOURCE_STALE');
 input:='{"sourceId":"synthetic-clock","identityType":"cpf","identityValue":"52998224725","employeeId":"ba200000-0000-4000-8000-000000000001","validFrom":"2026-10-17","validTo":null,"evidence":"Synthetic exact review"}';
 perform pg_temp.op_reject('binding','create',input||'{"identityValue":"52998224726"}','BINDING_INVALID');
 binding:=public.monitoring_binding_change('create',input)->'record';old_binding:=binding;
 mutation:=jsonb_build_object('id',binding->>'id','expectedUpdatedAt',binding->>'updated_at','reason','Synthetic corrected validity','binding',input||'{"validFrom":"2026-10-18"}');
 binding:=public.monitoring_binding_change('replace',mutation)->'record';
 perform pg_temp.op_assert(binding->>'supersedes_id'=old_binding->>'id' and binding->>'revision'='2','binding successor');
 perform pg_temp.op_reject('binding','replace',mutation,'BINDING_STALE');
 perform pg_temp.op_reject('binding','create',input,'IDENTITY_VALIDITY_CONFLICT');
 binding:=public.monitoring_binding_change('revoke',jsonb_build_object('id',binding->>'id','expectedUpdatedAt',binding->>'updated_at','reason','Synthetic revocation'))->'record';
 binding:=public.monitoring_binding_change('restore',jsonb_build_object('id',binding->>'id','expectedUpdatedAt',binding->>'updated_at','reason','Synthetic restoration'))->'record';
 perform pg_temp.op_assert(binding->>'revision'='3' and binding->>'revoked_at' is null,'restored next revision');
 perform pg_temp.op_reject('source','save',source_data||jsonb_build_object('expectedUpdatedAt',source->>'configuration_updated_at','identityNamespace','different'),'SOURCE_CONTRACT_IMMUTABLE');
 source:=public.monitoring_sources_admin('save',source_data||jsonb_build_object('expectedUpdatedAt',source->>'configuration_updated_at','active',false))->'record';
 perform pg_temp.op_reject('binding','create',input,'SOURCE_DISABLED');
 source:=public.monitoring_sources_admin('save',source_data||jsonb_build_object('expectedUpdatedAt',source->>'configuration_updated_at'))->'record';
 input:=jsonb_build_object('kind','clock','metadata',jsonb_build_object('sha256',repeat('a',64),'fileName','synthetic.csv'),'defaults',jsonb_build_object('sourceId','synthetic-clock','validFrom','2026-10-18','reason','Synthetic confirmed register'),'rows',jsonb_build_array(
  jsonb_build_object('line',2,'input',jsonb_build_object('employeeNumber','000124','name','Synthetic Two','cpf','11144477735'),'errors','[]'::jsonb),
  jsonb_build_object('line',3,'input',jsonb_build_object('employeeNumber','123','name','Synthetic One','cpf','52998224725'),'errors','[]'::jsonb)));
 batch:=public.operational_import('preview',input);
 perform pg_temp.op_assert(batch#>>'{rows,0,state}'='ready' and batch#>>'{rows,1,state}'='blocked','exact leading zero match only');
 newer:=public.operational_import('preview',input);perform pg_temp.op_assert(newer->>'id'=batch->>'id','preview idempotency');batch:=newer;
 mutation:=jsonb_build_object('id',batch->>'id','expectedUpdatedAt',batch->>'updatedAt','lines',jsonb_build_array(2));
 batch:=public.operational_import('confirm',mutation);perform pg_temp.op_assert(batch#>>'{rows,0,state}'='applied','clock import confirmed');
 newer:=public.operational_import('confirm',mutation);perform pg_temp.op_assert(newer#>>'{rows,0,result}'=batch#>>'{rows,0,result}','confirmation retry no duplicate');
 perform set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000002',true);
 perform pg_temp.op_reject('import','get',jsonb_build_object('id',batch->>'id'),'IMPORT_NOT_FOUND');
 perform set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000003',true);
 perform pg_temp.op_reject('source','list','{}','SOURCE_FORBIDDEN');perform pg_temp.op_reject('binding','create','{}','BINDING_FORBIDDEN');perform pg_temp.op_reject('import','preview','{}','IMPORT_FORBIDDEN');
 perform set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000001',true);
 input:=jsonb_build_object('kind','bank','metadata',jsonb_build_object('sha256',repeat('b',64),'fileName','bank.csv'),'defaults',jsonb_build_object('reason','Synthetic financial review'),'rows',jsonb_build_array(
  jsonb_build_object('line',2,'input',jsonb_build_object('employeeNumber','000123','name','Synthetic One','measurementDate','2026-10-17','effectiveFrom','2026-10-17','workdayHours',8,'balanceMinutes',-15),'errors','[]'::jsonb),
  jsonb_build_object('line',3,'input',jsonb_build_object('employeeNumber','000124','name','Wrong Name','measurementDate','2026-10-17','effectiveFrom','2026-10-17','workdayHours',8,'balanceMinutes',30),'errors','[]'::jsonb)));
 batch:=public.operational_import('preview',input);perform pg_temp.op_assert(batch#>>'{rows,1,state}'='blocked','name mismatch blocked');
 mutation:=jsonb_build_object('id',batch->>'id','expectedUpdatedAt',batch->>'updatedAt','lines',jsonb_build_array(2,3));
 batch:=public.operational_import('confirm',mutation);perform pg_temp.op_assert(batch#>>'{rows,0,state}'='applied' and batch#>>'{rows,1,state}'='blocked','only selected valid rows apply');
 perform public.operational_import('confirm',mutation||jsonb_build_object('expectedUpdatedAt',batch->>'updatedAt'));
 -- A new recurring extract reports an occupied baseline per line and applies the other person.
 input:=jsonb_set(input,'{metadata,sha256}',to_jsonb(repeat('c',64)));
 input:=jsonb_set(input,'{rows,1,input,name}','"Synthetic Two"');
 batch:=public.operational_import('preview',input);
 mutation:=jsonb_build_object('id',batch->>'id','expectedUpdatedAt',batch->>'updatedAt','lines',jsonb_build_array(2,3));
 newer:=public.operational_import('confirm',mutation);
 perform pg_temp.op_assert(newer#>>'{rows,0,state}'='failed' and newer#>>'{rows,0,errors,0}'='BANK_ADMIN_BASELINE_CONFLICT' and newer#>>'{rows,1,state}'='applied','financial partial failure reported by line');
 perform pg_temp.op_reject('import','confirm',mutation,'IMPORT_STALE');
 newer:=public.operational_import('confirm',mutation||jsonb_build_object('expectedUpdatedAt',newer->>'updatedAt'));
 perform pg_temp.op_assert(newer#>>'{rows,1,state}'='applied','successful financial line is not repeated on retry');
 -- Disallow a crafted preview from editing an existing measurement behind the upload flow.
 input:=jsonb_set(input,'{rows,0,input,id}',to_jsonb('ba200000-0000-4000-8000-000000000001'::text));
 perform pg_temp.op_reject('import','preview',input,'IMPORT_INVALID');
end$$;
reset role;
select pg_temp.op_assert((select count(*) from public.banco_horas_medicoes where colaborador_id='ba200000-0000-4000-8000-000000000001')=1,'financial replay no duplicate');
select pg_temp.op_assert(exists(select 1 from public.monitoring_jobs where employee_id='ba200000-0000-4000-8000-000000000001' and operational_date='2026-10-17'),'first binding queues already imported identity events');
select pg_temp.op_assert((select count(*) from private.time_bank_measurement_audit where actor='ba100000-0000-4000-8000-000000000001')=2,'individual financial audit reused');
select pg_temp.op_assert((select count(*) from public.chamada_diaria where colaborador_id::text like 'ba200000-%')=0,'imports do not overwrite manual attendance');
set local role service_role;
select pg_temp.op_assert((public.monitoring_worker_sources(array['synthetic-clock','not-registered'])->'sources'->0->>'id')='synthetic-clock','worker known metadata only');
select public.monitoring_ingest('{"protocolVersion":1,"heartbeat":{"sourceId":"synthetic-clock","state":"idle","source":{"id":"synthetic-clock","kind":"afd","timeZone":"America/Sao_Paulo","identityNamespace":"synthetic-clock","sourceIdentityConfirmed":false}}}');
reset role;
select pg_temp.op_assert((select configuration->>'sourceIdentityConfirmed' from public.monitoring_sources where id='synthetic-clock')='true','stale worker cannot replace UI metadata');
update public.monitoring_sources set active=false where id='synthetic-clock';
set local role service_role;
do $$begin
 begin perform public.monitoring_ingest('{"protocolVersion":1,"heartbeat":{"sourceId":"synthetic-clock","state":"idle"}}');
 exception when others then if sqlerrm='SOURCE_DISABLED' then return;else raise;end if;end;
 raise exception 'Expected SOURCE_DISABLED';
end$$;
reset role;
rollback;
