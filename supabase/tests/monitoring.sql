-- Synthetic integration fixtures. This script runs inside the disposable PGlite database.
begin;
insert into public.colaboradores(id,matricula,nome,unidade_id,gestor_id,situacao) values
 ('80000000-0000-0000-0000-000000000001','MON-001','Pessoa Sintetica A',(select id from public.unidades where codigo='CD I'),'20000000-0000-0000-0000-000000000001','ATIVO'),
 ('80000000-0000-0000-0000-000000000002','MON-002','Pessoa Sintetica B',(select id from public.unidades where codigo='CD II'),'20000000-0000-0000-0000-000000000001','ATIVO'),
 ('80000000-0000-0000-0000-000000000003','MON-003','Pessoa Sintetica C',(select id from public.unidades where codigo='CD I'),'20000000-0000-0000-0000-000000000002','ATIVO');
insert into auth.users(id,email,raw_user_meta_data) values ('90000000-0000-0000-0000-000000000001',encode(sha256(convert_to('00000000101','UTF8')),'hex')||'@auth.administrativo-cd.invalid','{"nome_completo":"Gestor Monitoramento","cpf_normalizado":"00000000101"}');
insert into auth.users(id,email,raw_user_meta_data) values ('90000000-0000-0000-0000-000000000002',encode(sha256(convert_to('00000000102','UTF8')),'hex')||'@auth.administrativo-cd.invalid','{"nome_completo":"Gestor Sem Vinculo","cpf_normalizado":"00000000102"}');
update public.perfis set status_usuario='APROVADO',papel_usuario='GESTOR',gestor_id=null,aprovado_em=now() where id='90000000-0000-0000-0000-000000000002';
update public.perfis set status_usuario='APROVADO',papel_usuario='GESTOR',gestor_id='20000000-0000-0000-0000-000000000001',aprovado_em=now() where id='90000000-0000-0000-0000-000000000001';

set local role service_role;
select public.monitoring_ingest('{"heartbeat":{"sourceId":"test-access","state":"scanning","source":{"id":"test-access","kind":"defense-access","timeZone":"America/Sao_Paulo","identityNamespace":"test-defense"}}}');
select public.monitoring_ingest('{"heartbeat":{"sourceId":"test-person","state":"idle","source":{"id":"test-person","kind":"defense-person","timeZone":"America/Sao_Paulo","identityNamespace":"test-defense"}}}');
do $$ begin
 begin perform public.monitoring_ingest('{"heartbeat":{"sourceId":"test-access","state":"scanning","source":{"id":"test-access","kind":"defense-access","timeZone":"America/Sao_Paulo","identityNamespace":"other-namespace"}}}');
 raise exception 'Heartbeat changed immutable source identity';
 exception when raise_exception then if sqlerrm<>'SOURCE_CONTRACT_CONFLICT' then raise; end if; end;
end $$;
select public.monitoring_ingest('{"failure":{"sourceId":"test-access","relativePath":"incomplete.xlsx","code":"FILE_NOT_STABLE"}}');
select public.monitoring_ingest(jsonb_build_object('source',jsonb_build_object('id','test-access','kind','defense-access','timeZone','America/Sao_Paulo','identityNamespace','test-defense'),
 'file',jsonb_build_object('sha256',repeat('a',64),'byteLength',100,'parserVersion','test-v1','relativePath','a.xlsx'),
 'batch',jsonb_build_object('index',1,'final',true,'occurrenceCount',2,'totalBatches',2),
 'occurrences',jsonb_build_array(jsonb_build_object('key','row2','line',2,'payloadHash',repeat('c',64),'event',jsonb_build_object('key','event1','type','access','identity',jsonb_build_object('type','defense','value','000123'),'timestamp','2026-10-10T11:00:00Z','device','Portal','classification','authorized','eligible',true)))));
reset role;
do $$ begin if (select status from public.monitoring_files where source_id='test-access')<>'processing' then raise exception 'Final batch prematurely completed file'; end if; end $$;
set local role service_role;
select public.monitoring_ingest(jsonb_build_object('source',jsonb_build_object('id','test-access','kind','defense-access','timeZone','America/Sao_Paulo','identityNamespace','test-defense'),
 'file',jsonb_build_object('sha256',repeat('a',64),'byteLength',100,'parserVersion','test-v1','relativePath','renamed.xlsx'),
 'batch',jsonb_build_object('index',0,'final',false,'occurrenceCount',2,'totalBatches',2),
 'occurrences',jsonb_build_array(jsonb_build_object('key','row1','line',1,'payloadHash',repeat('c',64),'event',jsonb_build_object('key','event1','type','access','identity',jsonb_build_object('type','defense','value','000123'),'timestamp','2026-10-10T11:00:00Z','device','Portal','classification','authorized','eligible',true)))));
-- A retry is a no-op even with a renamed file.
select public.monitoring_ingest(jsonb_build_object('source',jsonb_build_object('id','test-access','kind','defense-access','timeZone','America/Sao_Paulo','identityNamespace','test-defense'),
 'file',jsonb_build_object('sha256',repeat('a',64),'byteLength',100,'parserVersion','test-v1','relativePath','again.xlsx'),
 'batch',jsonb_build_object('index',0,'final',false,'occurrenceCount',2,'totalBatches',2),'occurrences','[]'::jsonb));
select public.monitoring_ingest(jsonb_build_object('photo',jsonb_build_object('sourceId','test-person','identityValue','000123','sha256',repeat('d',64),'mimeType','image/jpeg','base64','YWJj')));
reset role;
do $$ begin
 if (select count(*) from public.monitoring_events where source_id='test-access')<>1 then raise exception 'Canonical duplication'; end if;
 if (select count(*) from public.monitoring_occurrences where file_id in(select id from public.monitoring_files where source_id='test-access'))<>2 then raise exception 'Multiplicity lost'; end if;
 if (select status from public.monitoring_files where source_id='test-access')<>'complete' then raise exception 'Complete file not acknowledged'; end if;
 if (select count(*) from public.monitoring_attempts where source_id='test-access')<>1 then raise exception 'Failure history missing'; end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.monitoring_query('bind','{"sourceId":"test-access","identityType":"defense","identityValue":"000123","employeeId":"80000000-0000-0000-0000-000000000001","validFrom":"2026-01-01","evidence":"Correspondencia sintetica confirmada"}');
do $$ begin
 begin
 perform public.monitoring_query('bind','{"sourceId":"test-person","identityType":"defense","identityValue":"000123","employeeId":"80000000-0000-0000-0000-000000000002","validFrom":"2026-02-01","evidence":"Tentativa conflitante sintetica"}');
 raise exception 'Overlapping namespace binding accepted';
 exception when raise_exception then if sqlerrm<>'IDENTITY_VALIDITY_CONFLICT' then raise; end if; end;
 if (public.monitoring_query('photo','{"employeeId":"80000000-0000-0000-0000-000000000001"}')->>'base64')<>'YWJj' then raise exception 'Cross-source namespace photo missing'; end if;
 begin perform public.monitoring_query('setting','{"kind":"coverage","target":"invalid-coverage","validFrom":"2026-10-01","reason":"Synthetic invalid interval","payload":{"start":"2026-10-01T12:00:00Z","end":"2026-10-01T11:00:00Z"}}');
 raise exception 'Reversed coverage persisted'; exception when raise_exception then if sqlerrm not in ('INVALID_COVERAGE_INTERVAL','SETTING_INVALID_INPUT') then raise; end if; end;
 perform public.monitoring_query('setting','{"kind":"user_link","target":"80000000-0000-0000-0000-000000000001","validFrom":"2026-10-01","reason":"Synthetic account match","payload":{"userId":"90000000-0000-0000-0000-000000000001"}}');
 begin perform public.monitoring_query('setting','{"kind":"user_link","target":"80000000-0000-0000-0000-000000000002","validFrom":"2026-10-01","reason":"Synthetic conflicting match","payload":{"userId":"90000000-0000-0000-0000-000000000001"}}');
 raise exception 'Same account linked to two employees'; exception when raise_exception then if sqlerrm<>'USER_LINK_CONFLICT' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare data jsonb; begin
 data:=public.monitoring_query('summary','{"start":"2026-10-01","end":"2026-10-31","query":"Pessoa Sintetica"}');
 if (data->>'people')::int<>2 then raise exception 'Manager must read own people across units'; end if;
 begin perform public.monitoring_query('detail','{"employeeId":"80000000-0000-0000-0000-000000000003","start":"2026-10-01","end":"2026-10-31"}'); raise exception 'Cross-team detail exposed'; exception when insufficient_privilege then null; end;
 begin perform public.monitoring_query('photo','{"employeeId":"80000000-0000-0000-0000-000000000003"}'); raise exception 'Cross-team photo exposed'; exception when insufficient_privilege then null; end;
 begin perform public.monitoring_query('admin','{}'); raise exception 'Manager admin exposure'; exception when insufficient_privilege then null; end;
 begin perform public.monitoring_ingest('{}'); raise exception 'Authenticated ingestion'; exception when insufficient_privilege then null; end;
 begin perform public.monitoring_save_result('{}'); raise exception 'Arbitrary authenticated totals'; exception when insufficient_privilege then null; end;
 begin perform public.monitoring_worker('claim','{}'); raise exception 'Worker jobs exposed'; exception when insufficient_privilege then null; end;
 begin perform count(*) from public.monitoring_photos; raise exception 'Raw photos exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$ begin if (public.monitoring_query('summary','{"start":"2026-10-01","end":"2026-10-31"}')->>'people')::int<>0 then raise exception 'Unlinked manager global scope'; end if; end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
set local role authenticated;
do $$ begin
 perform public.monitoring_query('summary','{"start":"2026-10-01","end":"2026-10-31"}');
 begin perform public.monitoring_query('setting','{}'); raise exception 'Reader wrote config'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000007',true);
set local role authenticated;
do $$ begin begin perform public.monitoring_query('summary','{"start":"2026-10-01","end":"2026-10-31"}'); raise exception 'Pending read exposed'; exception when insufficient_privilege then null; end; end $$;
reset role;
set local role anon;
do $$ begin begin perform public.monitoring_query('summary','{}'); raise exception 'Anonymous RPC exposed'; exception when insufficient_privilege then null; end; end $$;
reset role;
set local role service_role;
do $$ declare claimed jsonb; next_claim jsonb; job jsonb; payload jsonb; begin
 claimed:=public.monitoring_worker('claim','{"sourceIds":["test-access"],"limit":1}');
 if jsonb_array_length(claimed->'jobs')<>1 then raise exception 'Bound event did not queue reprocessing'; end if;
 job:=claimed#>'{jobs,0}';
 next_claim:=public.monitoring_worker('claim','{"sourceIds":["test-access"],"limit":1}');
 if next_claim#>>'{jobs,0,leaseToken}'=job->>'leaseToken' then raise exception 'A job was leased twice'; end if;
 payload:=jsonb_build_object('employeeId',job->>'employeeId','date',job->>'date','version',(job#>>'{input,version}')::bigint,'ruleVersion','synthetic','result','{}'::jsonb,
  'summary','{"quality":"unavailable","workedSeconds":null,"late":null}'::jsonb,'reason','Synthetic queue validation','actor',null,'leaseToken',job->>'leaseToken');
 begin perform public.monitoring_save_result(payload||jsonb_build_object('version',-1)); raise exception 'Stale snapshot saved';
 exception when raise_exception then if sqlerrm<>'MONITORING_STALE_INPUT' then raise; end if; end;
 perform public.monitoring_worker('finish',payload);
 begin perform public.monitoring_worker('finish',payload); raise exception 'Lease replay accepted';
 exception when raise_exception then if sqlerrm<>'MONITORING_LEASE_LOST' then raise; end if; end;
 -- A manual reprocess replaces the active result while retaining its history.
 perform public.monitoring_save_result(payload);
 perform public.monitoring_worker('retry',(next_claim#>'{jobs,0}')||'{"code":"SYNTHETIC_RETRY"}'::jsonb);
end $$;
reset role;
do $$ begin
 if (select count(*) from public.monitoring_results where employee_id='80000000-0000-0000-0000-000000000001' and active)<>1 then raise exception 'Concurrent active result'; end if;
 if (select count(*) from public.monitoring_results where employee_id='80000000-0000-0000-0000-000000000001')<>2 then raise exception 'Result history not preserved'; end if;
 if not exists(select 1 from public.monitoring_jobs where last_error='SYNTHETIC_RETRY') then raise exception 'Retry state not preserved'; end if;
end $$;
rollback;
