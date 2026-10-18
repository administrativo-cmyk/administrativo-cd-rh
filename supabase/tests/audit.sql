-- Synthetic, rolled back. Role isolation, privacy, filtering and stable pagination.
begin;
insert into auth.users(id,email,raw_user_meta_data)
select ('ae000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 encode(sha256(convert_to('66666666'||lpad(i::text,3,'0'),'UTF8')),'hex')||'@auth.administrativo-cd.invalid',
 jsonb_build_object('nome_completo','Audit synthetic '||i,'cpf_normalizado','66666666'||lpad(i::text,3,'0')) from generate_series(1,4) i;
update public.perfis set status_usuario='APROVADO',papel_usuario=case right(id::text,1) when '1' then 'ADMIN'::public.papel_usuario when '2' then 'RH'::public.papel_usuario else 'LEITURA'::public.papel_usuario end,aprovado_em=now() where id::text like 'ae000000-%' and right(id::text,1)<>'4';
create function pg_temp.audit_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'Audit assertion: %',label; end if; end $$;
insert into public.monitoring_audit(actor,action,target,detail,created_at) values
 ('ae000000-0000-4000-8000-000000000001','audit_test','synthetic-record','{"reason":"Synthetic reason","cpf":"12345678901","nested":{"token":"never-disclose","identityValue":"12345678901"},"rows":[{"senha":"never-disclose"}]}','2026-10-17T12:00:00Z'),
 ('ae000000-0000-4000-8000-000000000001','audit_test','synthetic-second','{}','2026-10-17T13:00:00Z');
insert into private.user_edit_audit(user_id,actor,reason,before_record,after_record,created_at) values('ae000000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-000000000001','Synthetic permission edit','{}','{"name":"Admin"}','2026-10-17T14:00:00Z');
insert into public.colaboradores(id,matricula,nome,unidade_id) values('ae100000-0000-4000-8000-000000000001','AUDIT-EMP','Audit person reprocessed',(select id from public.unidades where codigo='CD I'));
insert into public.monitoring_audit(actor,action,target,detail,created_at) values
 ('ae000000-0000-4000-8000-000000000001','save_source','audit-source','{"before":{"label":"Old"},"after":{"label":"New"},"reason":"Synthetic change"}','2026-10-17T15:00:00Z'),
 ('ae000000-0000-4000-8000-000000000001','reprocess','ae100000-0000-4000-8000-000000000001','{"reason":"Synthetic reprocess"}','2026-10-17T16:00:00Z');
select pg_temp.audit_assert(not has_table_privilege('authenticated','private.audit_history_records','select'),'direct view denied');
select pg_temp.audit_assert(not has_function_privilege('anon','public.audit_history(jsonb)','execute'),'anonymous RPC denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; next_page jsonb; params jsonb:='{"from":"2026-10-17","to":"2026-10-17","query":"synthetic","action":"audit_test","limit":1}'; begin
 result:=public.audit_history(params);
 perform pg_temp.audit_assert((result->>'total')::int=2,'filtered count');
 perform pg_temp.audit_assert(result->'rows'->0->>'recordId'='synthetic-second','descending order');
 next_page:=public.audit_history(params||jsonb_build_object('offset',1,'snapshot',result->>'snapshot'));
 perform pg_temp.audit_assert(next_page->'rows'->0->>'recordId'='synthetic-record','second page stable');
 perform pg_temp.audit_assert(position('never-disclose' in next_page::text)=0 and position('12345678901' in next_page::text)=0,'recursive sensitive masking');
 perform pg_temp.audit_assert(next_page->'rows'->0->'after'->'nested'->>'token'='[restrito]','token field masked');
 result:=public.audit_history('{"from":"2026-10-17","to":"2026-10-17","action":"save_source","query":"audit-source"}');
 perform pg_temp.audit_assert(result->'rows'->0->'before'->>'label'='Old' and result->'rows'->0->'after'->>'label'='New','true before after fields');
 result:=public.audit_history('{"from":"2026-10-17","to":"2026-10-17","query":"Audit person reprocessed"}');
 perform pg_temp.audit_assert((result->>'total')::int=1 and result->'rows'->0->>'employeeNumber'='AUDIT-EMP','reprocess employee search');
 begin perform public.audit_history('{"from":"2025-01-01","to":"2026-10-17"}'); raise exception 'accepted overlong'; exception when sqlstate '22023' then null; end;
 begin perform public.audit_history('{"from":"infinity","to":"infinity"}'); raise exception 'accepted infinite'; exception when sqlstate '22023' then null; end;
 perform set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000002',true);
 result:=public.audit_history('{"from":"2026-10-17","to":"2026-10-17","domain":"usuarios"}');
 perform pg_temp.audit_assert((result->>'total')::int=0,'RH cannot read privileged user history');
 result:=public.audit_history(params); perform pg_temp.audit_assert((result->>'total')::int=2,'RH reads monitoring audit');
 perform set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000003',true);
 begin perform public.audit_history(params); raise exception 'reader accepted'; exception when sqlstate '42501' then null; end;
 perform set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000004',true);
 begin perform public.audit_history(params); raise exception 'pending accepted'; exception when sqlstate '42501' then null; end;
end $$;
rollback;
