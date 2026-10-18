-- Monitoring is independent of attendance and the time bank. All access is RPC-only.
create table private.monitoring_revision (id boolean primary key default true check(id), version bigint not null default 1,results_version bigint not null default 1);
insert into private.monitoring_revision default values;
create table public.monitoring_sources (
 id text primary key check(length(id) between 1 and 100), kind text not null check(kind in ('afd','defense-access','defense-person')),
 timezone text not null default 'America/Sao_Paulo', identity_namespace text not null, heartbeat_at timestamptz, worker_state text,
 last_success_at timestamptz, last_error text, configuration jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.monitoring_files (
 id uuid primary key default gen_random_uuid(), source_id text not null references public.monitoring_sources,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'), byte_length bigint not null check(byte_length > 0),
 relative_path text not null, parser_version text not null,
 status text not null default 'processing' check(status in ('processing','complete','conflict','failed')),
 expected_rows integer check(expected_rows >= 0), expected_batches integer not null check(expected_batches>0), metadata jsonb not null, accepted_rows integer not null default 0,
 attempts integer not null default 0, new_events integer not null default 0, repeated_events integer not null default 0, conflict_rows integer not null default 0, rejected_rows integer not null default 0, processed_rows integer not null default 0,
 last_attempt_at timestamptz not null default now(),
 completed_at timestamptz, unique(source_id,sha256,parser_version)
);
create table public.monitoring_batches (
 file_id uuid not null references public.monitoring_files, batch_index integer not null check(batch_index >= 0),
 row_count integer not null check(row_count >= 0), final boolean not null, batch_hash text not null, received_at timestamptz not null default now(),
 primary key(file_id,batch_index,batch_hash)
);
create table public.monitoring_attempts (
 id bigint generated always as identity primary key, source_id text not null references public.monitoring_sources,
 relative_path text not null, code text not null, created_at timestamptz not null default now()
);
create index monitoring_attempts_source on public.monitoring_attempts(source_id);
create table public.monitoring_events (
 id uuid primary key default gen_random_uuid(), source_id text not null references public.monitoring_sources,
 event_key text not null, payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
 event_type text not null check(event_type in ('punch','access')), identity_type text, identity_value text,
 occurred_at timestamptz not null check(isfinite(occurred_at)), device text, classification text not null,
 eligible boolean not null, nsr text, payload jsonb not null, conflicted boolean not null default false,
 unique(source_id,event_key), check((identity_type is null) = (identity_value is null)),
 check(identity_type is null or identity_type in ('cpf','pis','defense')),
 check(identity_type not in ('cpf','pis') or identity_value ~ '^[0-9]{11}$'),
 check(event_type<>'punch' or (nsr is not null and nsr ~ '^[0-9]{9}$' and identity_type is not null and identity_type in ('cpf','pis'))),
 check(not eligible or (identity_value is not null and classification='authorized'))
);
create index monitoring_events_person_time on public.monitoring_events(source_id,identity_type,identity_value,occurred_at);
create index monitoring_events_device_time on public.monitoring_events(source_id,device,occurred_at);
create unique index monitoring_afd_nsr on public.monitoring_events(source_id,nsr) where event_type='punch' and nsr is not null;
create table public.monitoring_occurrences (
 file_id uuid not null references public.monitoring_files, occurrence_key text not null, line integer not null check(line > 0),
 sheet text, payload_hash text not null, event_id uuid references public.monitoring_events,
 payload jsonb not null, conflict boolean not null default false, primary key(file_id,occurrence_key)
);
create table public.monitoring_people (
 source_id text not null references public.monitoring_sources, external_id text not null, name text not null,
 groups jsonb not null default '[]', photo_reference text, ambiguous boolean not null default false, observed_at timestamptz not null default now(),
 file_id uuid not null references public.monitoring_files, primary key(source_id,external_id)
);
create table public.monitoring_bindings (
 id uuid primary key default gen_random_uuid(), source_id text not null references public.monitoring_sources,
 identity_type text not null check(identity_type in ('defense','cpf','pis','employee_number')),
 identity_value text not null check(length(identity_value) between 1 and 100),
 employee_id uuid not null references public.colaboradores, valid_from date not null check(isfinite(valid_from)),
 valid_to date check(isfinite(valid_to) and valid_to >= valid_from), evidence text not null check(length(evidence)>=5),
 created_by uuid not null references public.perfis, created_at timestamptz not null default now(), revoked_at timestamptz
);
create index monitoring_bindings_identity on public.monitoring_bindings(source_id,identity_type,identity_value,valid_from,valid_to) where revoked_at is null;
create table public.monitoring_settings (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('mapping','schedule','policy','coverage','rule','user_link','group_snapshot','evidence','manual_event')),
 target text not null, valid_from date not null check(isfinite(valid_from)), valid_to date check(isfinite(valid_to) and valid_to>=valid_from),
 payload jsonb not null check(jsonb_typeof(payload)='object'), reason text not null check(length(reason)>=5),
 created_by uuid references public.perfis, created_at timestamptz not null default now(), revoked_at timestamptz
);
create index monitoring_settings_validity on public.monitoring_settings(kind,target,valid_from,valid_to) where revoked_at is null;
create table public.monitoring_photos (
 source_id text not null references public.monitoring_sources, identity_value text not null,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'), mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 base64 text not null check(length(base64) <= 2800000), updated_at timestamptz not null default now(),
 primary key(source_id,identity_value)
);
create table public.monitoring_results (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.colaboradores,
 operational_date date not null check(isfinite(operational_date)), input_version bigint not null,
 rule_version text not null, result jsonb not null, summary jsonb not null, active boolean not null default true,
 dirty boolean not null default false, computed_at timestamptz not null default now(), reason text not null
);
create unique index monitoring_result_active on public.monitoring_results(employee_id,operational_date) where active;
create index monitoring_result_date on public.monitoring_results(operational_date,employee_id) where active;
create table public.monitoring_jobs (
 employee_id uuid not null references public.colaboradores, operational_date date not null check(isfinite(operational_date)),
 reason text not null, created_at timestamptz not null default now(), lease_token uuid, leased_until timestamptz,
 attempts integer not null default 0, last_error text, primary key(employee_id,operational_date)
);
create table public.monitoring_audit (
 id bigint generated always as identity primary key, actor uuid references public.perfis, action text not null,
 target text not null, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create index monitoring_occurrences_event on public.monitoring_occurrences(event_id);
create index monitoring_people_file on public.monitoring_people(file_id);
create index monitoring_bindings_employee on public.monitoring_bindings(employee_id);
create index monitoring_bindings_author on public.monitoring_bindings(created_by);
create index monitoring_settings_author on public.monitoring_settings(created_by);
create index monitoring_audit_actor on public.monitoring_audit(actor);

create function private.monitoring_enqueue(p_employee uuid default null,p_start date default null,p_end date default null,p_source text default null) returns void
language plpgsql security definer set search_path='' as $$ begin
 insert into public.monitoring_jobs(employee_id,operational_date,reason)
 select distinct b.employee_id,((e.occurred_at at time zone 'America/Sao_Paulo')::date+delta.n),'Dados ou regras alterados'
 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
 join public.monitoring_sources es on es.identity_namespace=bs.identity_namespace
 join public.monitoring_events e on e.source_id=es.id and e.identity_type=b.identity_type and e.identity_value=b.identity_value
 cross join (values(-1),(0),(1)) delta(n)
 where b.revoked_at is null and (p_employee is null or b.employee_id=p_employee)
 and (p_source is null or es.identity_namespace=(select identity_namespace from public.monitoring_sources where id=p_source))
 and (e.occurred_at at time zone 'America/Sao_Paulo')::date between b.valid_from and coalesce(b.valid_to,'9999-12-31')
 and ((e.occurred_at at time zone 'America/Sao_Paulo')::date+delta.n) between coalesce(p_start,'0001-01-01') and coalesce(p_end,'9999-12-31')
 on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
 insert into public.monitoring_jobs(employee_id,operational_date,reason)
 select r.employee_id,r.operational_date,'Apuração invalidada' from public.monitoring_results r where active and dirty and (p_employee is null or r.employee_id=p_employee)
 and (p_source is null or exists(select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
   where b.employee_id=r.employee_id and bs.identity_namespace=(select identity_namespace from public.monitoring_sources where id=p_source)))
 and operational_date between coalesce(p_start,'0001-01-01') and coalesce(p_end,'9999-12-31')
 on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
end $$;
revoke all on function private.monitoring_enqueue(uuid,date,date,text) from public,anon,authenticated,service_role;

-- Explicit initial policy effective from the sample's first operational day; only evidenced group snapshots apply.
insert into public.monitoring_settings(kind,target,valid_from,payload,reason) values
 ('policy','COZINHA JK','2026-09-30','{"indicator":"outsideOperation","scope":"group","exclude":true}','Exclusão inicial solicitada no plano; depende de grupo com vigência comprovada'),
 ('policy','LIDERANÇA JK','2026-09-30','{"indicator":"outsideOperation","scope":"group","exclude":true}','Exclusão inicial solicitada no plano; depende de grupo com vigência comprovada'),
 ('rule','global','2026-09-30','{"punchRepeatSeconds":60,"accessRepeatSeconds":10,"initialLookbackSeconds":3600,"maxJourneyHours":18}','Parâmetros iniciais solicitados; supressão analítica mantém origem');
insert into public.monitoring_settings(kind,target,valid_from,payload,reason) values
 ('mapping','Entrada Torniquete CD POLO JK_Porta1','2026-09-30','{"pointId":"Entrada Torniquete CD POLO JK_Porta1","portalId":"torniquete-jk","area":"operation","direction":"entry","validated":true,"eventClasses":["Desbloqueio por rosto"],"effects":{"perimeter":"inside","cafeteria":"outside"}}','Mapeamento operacional solicitado; autorização facial é inferência de passagem'),
 ('mapping','Saida Torniquete CD POLO JK_Porta1','2026-09-30','{"pointId":"Saida Torniquete CD POLO JK_Porta1","portalId":"torniquete-jk","area":"operation","direction":"exit","validated":true,"eventClasses":["Desbloqueio por rosto"]}','Mapeamento operacional solicitado; saída da operação não é saída do perímetro'),
 ('mapping','Entrada Refeitorio CD POLO JK_Porta1','2026-09-30','{"pointId":"Entrada Refeitorio CD POLO JK_Porta1","portalId":"refeitorio-jk","area":"cafeteria","direction":"entry","validated":true,"eventClasses":["Desbloqueio por rosto"],"effects":{"operation":"outside","perimeter":"inside"}}','Mapeamento operacional solicitado; refeitório externo à operação'),
 ('mapping','Saida Refeitorio CD POLO JK_Porta1','2026-09-30','{"pointId":"Saida Refeitorio CD POLO JK_Porta1","portalId":"refeitorio-jk","area":"cafeteria","direction":"exit","validated":true,"eventClasses":["Desbloqueio por rosto"]}','Mapeamento operacional solicitado; saída do refeitório não prova retorno à operação'),
 ('mapping','Entrada Principal CD POLO JK_Porta1','2026-09-30','{"pointId":"Entrada Principal CD POLO JK_Porta1","portalId":"principal-jk","area":"perimeter","direction":"entry","validated":false,"eventClasses":["Desbloqueio por rosto"]}','Orientação física pendente de confirmação; nenhuma saída identificada do perímetro na amostra');

create function private.monitoring_can_read(p_employee uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.perfis p join public.colaboradores c on c.id=p_employee
 where p.id=(select auth.uid()) and p.status_usuario='APROVADO'
 and (p.papel_usuario in ('ADMIN','RH','LEITURA') or (p.papel_usuario='GESTOR' and p.gestor_id is not null and c.gestor_id=p.gestor_id)))
$$;
revoke all on function private.monitoring_can_read(uuid) from public,anon,authenticated;

-- A single serializable ingest transaction per immutable batch. Conflicting AFD NSR is retained as evidence.
create function private.monitoring_ingest_impl(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s text; f uuid; o jsonb; e jsonb; v_event uuid; v_conflict boolean; v_rows integer:=0; v_new integer:=0; v_conflicts integer:=0; v_batch_hash text;
begin
 if p_data ? 'heartbeat' then
   if p_data#>'{heartbeat,source}' is not null then
     insert into public.monitoring_sources(id,kind,timezone,identity_namespace,configuration)
     values(p_data#>>'{heartbeat,sourceId}',p_data#>>'{heartbeat,source,kind}',p_data#>>'{heartbeat,source,timeZone}',coalesce(p_data#>>'{heartbeat,source,identityNamespace}',p_data#>>'{heartbeat,sourceId}'),p_data#>'{heartbeat,source}') on conflict(id) do nothing;
   end if;
   if p_data#>'{heartbeat,source}' is not null then
     if not exists(select 1 from public.monitoring_sources where id=p_data#>>'{heartbeat,sourceId}' and kind=p_data#>>'{heartbeat,source,kind}' and timezone=p_data#>>'{heartbeat,source,timeZone}'
       and identity_namespace=coalesce(p_data#>>'{heartbeat,source,identityNamespace}',p_data#>>'{heartbeat,sourceId}')) then raise exception 'SOURCE_CONTRACT_CONFLICT'; end if;
     if exists(select 1 from public.monitoring_sources where id=p_data#>>'{heartbeat,sourceId}' and configuration is distinct from p_data#>'{heartbeat,source}') then
       update private.monitoring_revision set version=version+1;
       update public.monitoring_results r set dirty=true where active and exists(select 1 from public.monitoring_bindings b where b.employee_id=r.employee_id and b.source_id=p_data#>>'{heartbeat,sourceId}' and b.revoked_at is null);
       perform private.monitoring_enqueue(null,null,null,p_data#>>'{heartbeat,sourceId}');
     end if;
     update public.monitoring_sources set configuration=p_data#>'{heartbeat,source}' where id=p_data#>>'{heartbeat,sourceId}';
   end if;
   update public.monitoring_sources set heartbeat_at=now(),worker_state=left(p_data#>>'{heartbeat,state}',40),last_error=p_data#>>'{heartbeat,code}' where id=p_data#>>'{heartbeat,sourceId}';
   return '{"ok":true}'::jsonb;
 end if;
 if p_data ? 'failure' then
   insert into public.monitoring_attempts(source_id,relative_path,code) values(p_data#>>'{failure,sourceId}',p_data#>>'{failure,relativePath}',p_data#>>'{failure,code}');
   return '{"ok":true}'::jsonb;
 end if;
 if p_data ? 'photo' then
   insert into public.monitoring_photos(source_id,identity_value,sha256,mime_type,base64)
   values(p_data#>>'{photo,sourceId}',p_data#>>'{photo,identityValue}',p_data#>>'{photo,sha256}',p_data#>>'{photo,mimeType}',p_data#>>'{photo,base64}')
   on conflict(source_id,identity_value) do update set sha256=excluded.sha256,mime_type=excluded.mime_type,base64=excluded.base64,updated_at=now();
   return '{"ok":true}'::jsonb;
 end if;
 s:=p_data#>>'{source,id}';
 insert into public.monitoring_sources(id,kind,timezone,identity_namespace,configuration,heartbeat_at,worker_state)
 values(s,p_data#>>'{source,kind}',p_data#>>'{source,timeZone}',coalesce(p_data#>>'{source,identityNamespace}',s),p_data->'source',now(),'running')
 on conflict(id) do update set heartbeat_at=now(),worker_state='running';
 if not exists(select 1 from public.monitoring_sources where id=s and kind=p_data#>>'{source,kind}' and timezone=p_data#>>'{source,timeZone}' and identity_namespace=coalesce(p_data#>>'{source,identityNamespace}',s)) then
   raise exception 'SOURCE_CONTRACT_CONFLICT';
 end if;
 insert into public.monitoring_files(source_id,sha256,byte_length,relative_path,parser_version,expected_rows,expected_batches,metadata)
 values(s,p_data#>>'{file,sha256}',(p_data#>>'{file,byteLength}')::bigint,p_data#>>'{file,relativePath}',p_data#>>'{file,parserVersion}',(p_data#>>'{batch,occurrenceCount}')::integer,(p_data#>>'{batch,totalBatches}')::integer,p_data->'file')
 on conflict(source_id,sha256,parser_version) do update set attempts=public.monitoring_files.attempts+1,last_attempt_at=now()
 returning id into f;
 perform 1 from public.monitoring_files where id=f for update;
 if not exists(select 1 from public.monitoring_files where id=f and expected_rows=(p_data#>>'{batch,occurrenceCount}')::integer and byte_length=(p_data#>>'{file,byteLength}')::bigint) then raise exception 'IMMUTABLE_FILE_CONTRACT_CONFLICT'; end if;
 v_batch_hash:=encode(sha256(convert_to((p_data->'occurrences')::text,'UTF8')),'hex');
 if exists(select 1 from public.monitoring_batches where file_id=f and batch_index=(p_data#>>'{batch,index}')::integer and batch_hash=v_batch_hash) then
   return jsonb_build_object('ok',true,'duplicate',true,'fileId',f,'fileStatus',(select status from public.monitoring_files where id=f));
 end if;
 for o in select value from jsonb_array_elements(p_data->'occurrences') loop
   v_event:=null; v_conflict:=false; e:=o->'event';
   if e is not null and e<>'null'::jsonb then
     insert into public.monitoring_events(source_id,event_key,payload_hash,event_type,identity_type,identity_value,occurred_at,device,classification,eligible,nsr,payload)
     values(s,e->>'key',o->>'payloadHash',e->>'type',e#>>'{identity,type}',e#>>'{identity,value}',(e->>'timestamp')::timestamptz,e->>'device',e->>'classification',(e->>'eligible')::boolean,e->>'nsr',e)
     on conflict(source_id,event_key) do nothing returning id into v_event;
     if v_event is null then
       select id,(event_type='punch' and payload_hash<>o->>'payloadHash') into v_event,v_conflict from public.monitoring_events where source_id=s and event_key=e->>'key';
       if v_conflict then update public.monitoring_events set conflicted=true,eligible=false where id=v_event; v_conflicts:=v_conflicts+1; end if;
     else v_new:=v_new+1; end if;
   end if;
   insert into public.monitoring_occurrences(file_id,occurrence_key,line,sheet,payload_hash,event_id,payload,conflict)
   values(f,o->>'key',(o->>'line')::integer,o->>'sheet',o->>'payloadHash',v_event,o,v_conflict) on conflict do nothing;
   if o ? 'person' and o->'person'<>'null'::jsonb then
     insert into public.monitoring_people(source_id,external_id,name,groups,photo_reference,file_id)
     values(s,o#>>'{person,externalId}',o#>>'{person,name}',coalesce(o#>'{person,groups}','[]'::jsonb),o#>>'{person,photoReference}',f)
     on conflict(source_id,external_id) do update set
       ambiguous=public.monitoring_people.ambiguous or public.monitoring_people.name is distinct from excluded.name or public.monitoring_people.groups is distinct from excluded.groups or public.monitoring_people.photo_reference is distinct from excluded.photo_reference,
       name=case when (select sha256 from public.monitoring_files where id=f)<(select sha256 from public.monitoring_files where id=public.monitoring_people.file_id) then excluded.name else public.monitoring_people.name end,
       groups=case when (select sha256 from public.monitoring_files where id=f)<(select sha256 from public.monitoring_files where id=public.monitoring_people.file_id) then excluded.groups else public.monitoring_people.groups end,
       photo_reference=case when (select sha256 from public.monitoring_files where id=f)<(select sha256 from public.monitoring_files where id=public.monitoring_people.file_id) then excluded.photo_reference else public.monitoring_people.photo_reference end,
       file_id=case when (select sha256 from public.monitoring_files where id=f)<(select sha256 from public.monitoring_files where id=public.monitoring_people.file_id) then f else public.monitoring_people.file_id end;
   end if;
   v_rows:=v_rows+1;
 end loop;
 insert into public.monitoring_batches(file_id,batch_index,row_count,final,batch_hash) values(f,(p_data#>>'{batch,index}')::integer,v_rows,(p_data#>>'{batch,final}')::boolean,v_batch_hash);
 update public.monitoring_files set processed_rows=(select count(*) from public.monitoring_occurrences where file_id=f),
 accepted_rows=(select count(*) from public.monitoring_occurrences oc where file_id=f and (payload ? 'event' or payload ? 'person') and not exists(select 1 from jsonb_array_elements(coalesce(oc.payload->'issues','[]')) i where i->>'severity'='error')),
 new_events=new_events+v_new, repeated_events=greatest(0,(select count(*) from public.monitoring_occurrences where file_id=f and event_id is not null and not conflict)-(new_events+v_new)),
 conflict_rows=(select count(*) from public.monitoring_occurrences where file_id=f and conflict),
 rejected_rows=(select count(*) from public.monitoring_occurrences oc where file_id=f and exists(select 1 from jsonb_array_elements(coalesce(oc.payload->'issues','[]')) i where i->>'severity'='error')),
 status=case when (select count(*) from public.monitoring_occurrences where file_id=f)=expected_rows
 and exists(select 1 from public.monitoring_batches where file_id=f and final)
 then case when exists(select 1 from public.monitoring_occurrences where file_id=f and conflict) then 'conflict' else 'complete' end else 'processing' end
 where id=f;
 update public.monitoring_files set completed_at=now() where id=f and status in ('complete','conflict');
 update public.monitoring_sources set last_success_at=now() where id=s and exists(select 1 from public.monitoring_files where id=f and completed_at is not null);
 if v_new>0 or v_conflicts>0 then
   update private.monitoring_revision set version=version+1;
   update public.monitoring_results r set dirty=true where active and exists(
    select 1 from public.monitoring_bindings b join public.monitoring_events ev on (select identity_namespace from public.monitoring_sources where id=ev.source_id)=(select identity_namespace from public.monitoring_sources where id=b.source_id) and ev.identity_type=b.identity_type and ev.identity_value=b.identity_value
    join public.monitoring_occurrences oc on oc.event_id=ev.id and oc.file_id=f
    where b.employee_id=r.employee_id and b.revoked_at is null and r.operational_date between (ev.occurred_at at time zone 'America/Sao_Paulo')::date-1 and (ev.occurred_at at time zone 'America/Sao_Paulo')::date+1);
   perform private.monitoring_enqueue(null,(select min((ev.occurred_at at time zone 'America/Sao_Paulo')::date)-1 from public.monitoring_events ev join public.monitoring_occurrences oc on oc.event_id=ev.id where oc.file_id=f),
    (select max((ev.occurred_at at time zone 'America/Sao_Paulo')::date)+1 from public.monitoring_events ev join public.monitoring_occurrences oc on oc.event_id=ev.id where oc.file_id=f),s);
 end if;
 return jsonb_build_object('ok',true,'fileId',f,'rows',v_rows,'newEvents',v_new,'conflicts',v_conflicts,'fileStatus',(select status from public.monitoring_files where id=f));
end $$;
revoke all on function private.monitoring_ingest_impl(jsonb) from public,anon,authenticated;
grant execute on function private.monitoring_ingest_impl(jsonb) to service_role;
create function public.monitoring_ingest(p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.monitoring_ingest_impl(p_data) $$;
revoke all on function public.monitoring_ingest(jsonb) from public,anon,authenticated;
grant execute on function public.monitoring_ingest(jsonb) to service_role;

-- No direct Data API access, including raw identifiers and photos.
do $$ declare t text; begin
 foreach t in array array['monitoring_sources','monitoring_files','monitoring_batches','monitoring_attempts','monitoring_events','monitoring_occurrences','monitoring_people','monitoring_bindings','monitoring_settings','monitoring_photos','monitoring_results','monitoring_jobs','monitoring_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
grant usage on schema private to service_role;

create function private.monitoring_input(employee uuid,start_date date,end_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin 
   return jsonb_build_object('version',(select version from private.monitoring_revision),
     'sources',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind',s.kind,'configuration',s.configuration)),'[]'::jsonb) from public.monitoring_sources s),
     'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'sourceId',e.source_id,'payload',e.payload,'conflicted',e.conflicted,'eligible',e.eligible,
       'provenance',(select coalesce(jsonb_agg(jsonb_build_object('fileId',oc.file_id,'row',oc.line,'sourceId',e.source_id)),'[]'::jsonb) from public.monitoring_occurrences oc where oc.event_id=e.id)) order by e.occurred_at,e.id),'[]'::jsonb) from public.monitoring_events e
       where exists(select 1 from public.monitoring_bindings b where b.employee_id=employee and b.revoked_at is null and (select identity_namespace from public.monitoring_sources where id=b.source_id)=(select identity_namespace from public.monitoring_sources where id=e.source_id) and b.identity_type=e.identity_type and b.identity_value=e.identity_value
       and (e.occurred_at at time zone 'America/Sao_Paulo')::date between b.valid_from and coalesce(b.valid_to,'9999-12-31'))
       and e.occurred_at >= (start_date-1)::timestamp at time zone 'America/Sao_Paulo' and e.occurred_at < (end_date+2)::timestamp at time zone 'America/Sao_Paulo'),
     'settings',(select coalesce(jsonb_agg(to_jsonb(s) order by created_at),'[]'::jsonb) from public.monitoring_settings s where revoked_at is null and valid_from<=end_date and coalesce(valid_to,'9999-12-31')>=start_date));
 end $$;
revoke all on function private.monitoring_input(uuid,date,date) from public,anon,authenticated,service_role;

create function private.monitoring_query_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); role_name public.papel_usuario; employee uuid; item uuid; result jsonb; start_date date; end_date date;
begin
 select papel_usuario into role_name from public.perfis where id=actor and status_usuario='APROVADO';
 if actor is null or role_name is null then raise exception using errcode='42501',message='MONITORING_FORBIDDEN'; end if;
 if p_action in ('admin','bind','revoke_binding','setting','revoke_setting','input') and role_name not in ('ADMIN','RH') then
   raise exception using errcode='42501',message='MONITORING_ADMIN_REQUIRED';
 end if;
 if p_action in ('summary','detail','input') then
   start_date:=(p_data->>'start')::date; end_date:=(p_data->>'end')::date;
   if start_date is null or end_date is null or not isfinite(start_date) or not isfinite(end_date) or end_date<start_date or end_date-start_date>366 then raise exception 'INVALID_PERIOD'; end if;
 end if;
 if p_action in ('detail','input','photo') then
   employee:=(p_data->>'employeeId')::uuid;
   if not private.monitoring_can_read(employee) then raise exception using errcode='42501',message='MONITORING_FORBIDDEN'; end if;
 end if;
 if p_action='summary' then
   with rows as (
     select c.id as "employeeId", c.nome as name,c.matricula as "employeeNumber",u.codigo as unit,g.nome as manager,c.gestor_id as "managerId",
       r.operational_date as date,r.summary,r.dirty,r.computed_at as "computedAt",r.rule_version as "ruleVersion",
       case when r.id is null then 'pending' when r.dirty then 'stale' else r.summary->>'quality' end as quality
     from public.colaboradores c join public.unidades u on u.id=c.unidade_id left join public.gestores g on g.id=c.gestor_id
     left join public.monitoring_results r on r.employee_id=c.id and r.active and r.operational_date between start_date and end_date
     where private.monitoring_can_read(c.id)
       and (coalesce(p_data->>'employeeId','')='' or c.id::text=p_data->>'employeeId')
       and (coalesce(p_data->>'unit','')='' or u.codigo=p_data->>'unit')
       and (coalesce(p_data->>'managerId','')='' or c.gestor_id::text=p_data->>'managerId')
       and (coalesce(p_data->>'query','')='' or c.nome ilike '%'||(p_data->>'query')||'%' or c.matricula=p_data->>'query')
       and (coalesce(p_data->>'group','')='' or (r.summary->'groups') ? translate(upper(regexp_replace(trim(p_data->>'group'),'\s+',' ','g')),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC'))
       and (coalesce(p_data->>'schedule','')='' or r.summary->>'scheduleName'=p_data->>'schedule')
   ), filtered as (select * from rows where coalesce(p_data->>'quality','')='' or quality=p_data->>'quality'),
   paged as (select * from filtered order by name,"employeeId",date limit least(coalesce((p_data->>'limit')::int,50),500) offset greatest(coalesce((p_data->>'offset')::int,0),0))
   select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb),
    'total',(select count(*) from filtered),'people',(select count(distinct "employeeId") from filtered),
    'pending',(select count(*) from filtered where quality in ('pending','unavailable','stale')),
    'excluded',(select count(*) from filtered where quality='excluded'),
    'totals',(select jsonb_build_object('workedSeconds',sum((summary->>'workedSeconds')::numeric),'outsideSeconds',sum((summary->>'outsideSeconds')::numeric),
      'cafeteriaSeconds',sum((summary->>'cafeteriaSeconds')::numeric),'lateJourneys',case when count(summary->>'late')=0 then null else count(*) filter(where (summary->>'late')::boolean) end,
      'latenessAssessedJourneys',count(summary->>'late'),
      'assessedJourneys',count(*) filter(where quality not in ('pending','unavailable','stale')),
      'unknownSeconds',sum((summary->>'unknownSeconds')::numeric)) from filtered where quality<>'stale'),
    'datasetVersion',(select version::text||':'||results_version::text from private.monitoring_revision),
    'options',jsonb_build_object('units',(select coalesce(jsonb_agg(x.codigo order by x.codigo),'[]'::jsonb) from (select distinct u.codigo from public.colaboradores c join public.unidades u on u.id=c.unidade_id where private.monitoring_can_read(c.id)) x),
      'managers',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.nome) order by x.nome),'[]'::jsonb) from (select distinct g.id,g.nome from public.colaboradores c join public.gestores g on g.id=c.gestor_id where private.monitoring_can_read(c.id)) x)),
    'timezone','America/Sao_Paulo','queriedAt',now(),'start',start_date,'end',end_date) into result;
   return result;
 elsif p_action='detail' then
   return jsonb_build_object('results',(select coalesce(jsonb_agg(jsonb_build_object('date',operational_date,'result',r.result,'summary',r.summary,'dirty',dirty,'computedAt',computed_at) order by operational_date),'[]'::jsonb)
      from public.monitoring_results r where employee_id=employee and active and operational_date between start_date and end_date and (p_data->>'date' is null or operational_date=(p_data->>'date')::date)),
     'events',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
       select e.id,e.occurred_at as "timestamp",e.event_type as type,e.device,e.classification,e.eligible,e.conflicted,
       (select jsonb_agg(jsonb_build_object('fileId',o.file_id,'line',o.line,'sheet',o.sheet,'conflict',o.conflict)) from public.monitoring_occurrences o where o.event_id=e.id) as provenance
       from public.monitoring_events e where exists(select 1 from public.monitoring_bindings b where b.employee_id=employee and b.revoked_at is null
       and (select identity_namespace from public.monitoring_sources where id=b.source_id)=(select identity_namespace from public.monitoring_sources where id=e.source_id) and b.identity_type=e.identity_type and b.identity_value=e.identity_value
       and (e.occurred_at at time zone 'America/Sao_Paulo')::date between b.valid_from and coalesce(b.valid_to,'9999-12-31'))
       and e.occurred_at >= start_date::timestamp at time zone 'America/Sao_Paulo' and e.occurred_at < (end_date+2)::timestamp at time zone 'America/Sao_Paulo'
       order by e.occurred_at,e.id limit 100 offset greatest(coalesce((p_data->>'offset')::int,0),0)
     ) x));
 elsif p_action='photo' then
   select jsonb_build_object('mimeType',p.mime_type,'base64',p.base64,'sha256',p.sha256) into result from public.monitoring_photos p
   join public.monitoring_bindings b on (select identity_namespace from public.monitoring_sources where id=b.source_id)=(select identity_namespace from public.monitoring_sources where id=p.source_id) and b.identity_type='defense' and b.identity_value=p.identity_value
   where b.employee_id=employee and b.revoked_at is null and (now() at time zone 'America/Sao_Paulo')::date between b.valid_from and coalesce(b.valid_to,'9999-12-31') order by p.updated_at desc limit 1;
   return coalesce(result,'null'::jsonb);
 elsif p_action='my_photo' then
   select target::uuid into employee from public.monitoring_settings where kind='user_link' and payload->>'userId'=actor::text and revoked_at is null
    and (now() at time zone 'America/Sao_Paulo')::date between valid_from and coalesce(valid_to,'9999-12-31') order by created_at desc limit 1;
   if employee is null then return 'null'::jsonb; end if;
   -- Own profile photo is allowed without granting access to that employee's monitoring records.
   select jsonb_build_object('mimeType',p.mime_type,'base64',p.base64,'sha256',p.sha256) into result from public.monitoring_photos p
   join public.monitoring_bindings b on (select identity_namespace from public.monitoring_sources where id=b.source_id)=(select identity_namespace from public.monitoring_sources where id=p.source_id) and b.identity_type='defense' and b.identity_value=p.identity_value
   where b.employee_id=employee and b.revoked_at is null and (now() at time zone 'America/Sao_Paulo')::date between b.valid_from and coalesce(b.valid_to,'9999-12-31') order by p.updated_at desc limit 1;
   return coalesce(result,'null'::jsonb);
 elsif p_action='admin' then
   return jsonb_build_object('sources',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from public.monitoring_sources s),
     'files',(select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) from (select * from public.monitoring_files order by last_attempt_at desc limit 50) f),
     'attempts',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from (select * from public.monitoring_attempts order by id desc limit 50) a),
     'jobs',(select jsonb_build_object('pending',count(*),'failed',count(*) filter(where last_error is not null)) from public.monitoring_jobs),
     'settings',(select coalesce(jsonb_agg(to_jsonb(s) order by created_at desc),'[]'::jsonb) from public.monitoring_settings s),
     'bindings',(select coalesce(jsonb_agg(to_jsonb(b) order by created_at desc),'[]'::jsonb) from public.monitoring_bindings b),
     'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',nome,'employeeNumber',matricula) order by nome),'[]'::jsonb) from public.colaboradores),
     'users',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',nome_completo) order by nome_completo),'[]'::jsonb) from public.perfis where status_usuario='APROVADO'),
     'people',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select pe.source_id,pe.external_id,pe.name,pe.groups,pe.photo_reference,pe.ambiguous,
        exists(select 1 from public.monitoring_photos ph where ph.source_id=pe.source_id and ph.identity_value=pe.external_id) as has_photo,
        exists(select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id join public.monitoring_sources ps on ps.id=pe.source_id and bs.identity_namespace=ps.identity_namespace
          where b.identity_type='defense' and b.identity_value=pe.external_id and b.revoked_at is null) as linked
       from public.monitoring_people pe order by pe.name,pe.source_id,pe.external_id limit 100 offset greatest(coalesce((p_data->>'offset')::int,0),0)) x),
     'pending',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from (
       select distinct e.source_id,e.identity_type,e.identity_value,
         (select name from public.monitoring_people pe where (select identity_namespace from public.monitoring_sources where id=pe.source_id)=(select identity_namespace from public.monitoring_sources where id=e.source_id) and pe.external_id=e.identity_value limit 1) as name
       from public.monitoring_events e where e.identity_value is not null and not exists(select 1 from public.monitoring_bindings b where (select identity_namespace from public.monitoring_sources where id=b.source_id)=(select identity_namespace from public.monitoring_sources where id=e.source_id) and b.identity_type=e.identity_type and b.identity_value=e.identity_value and b.revoked_at is null
         and (e.occurred_at at time zone 'America/Sao_Paulo')::date between b.valid_from and coalesce(b.valid_to,'9999-12-31'))
       order by e.source_id,e.identity_type,e.identity_value limit 100 offset greatest(coalesce((p_data->>'offset')::int,0),0)) p),
     'audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from (select * from public.monitoring_audit order by id desc limit 50) a));
 elsif p_action='input' then
   return private.monitoring_input(employee,start_date,end_date);
 elsif p_action='bind' then
   perform pg_advisory_xact_lock(791701);
   employee:=(p_data->>'employeeId')::uuid;
   start_date:=(p_data->>'validFrom')::date; end_date:=(p_data->>'validTo')::date;
   if p_data->>'identityType' in ('cpf','pis') and not (p_data->>'identityValue' ~ '^[0-9]{11}$') then raise exception 'INVALID_IDENTIFIER'; end if;
   if exists(select 1 from public.monitoring_bindings b where (select identity_namespace from public.monitoring_sources where id=b.source_id)=(select identity_namespace from public.monitoring_sources where id=p_data->>'sourceId') and b.identity_type=p_data->>'identityType' and b.identity_value=p_data->>'identityValue' and b.revoked_at is null
     and b.valid_from<=coalesce(end_date,'9999-12-31') and coalesce(b.valid_to,'9999-12-31')>=start_date) then raise exception 'IDENTITY_VALIDITY_CONFLICT'; end if;
   insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,valid_to,evidence,created_by)
   values(p_data->>'sourceId',p_data->>'identityType',p_data->>'identityValue',employee,start_date,end_date,p_data->>'evidence',actor) returning id into item;
 elsif p_action='revoke_binding' then
   update public.monitoring_bindings set revoked_at=now() where id=(p_data->>'id')::uuid and revoked_at is null returning id,employee_id,valid_from,valid_to into item,employee,start_date,end_date;
   if item is null then raise exception 'BINDING_NOT_FOUND'; end if;
 elsif p_action='setting' then
   perform pg_advisory_xact_lock(791702);
   if p_data->>'kind'='coverage' and (not isfinite((p_data#>>'{payload,start}')::timestamptz) or not isfinite((p_data#>>'{payload,end}')::timestamptz) or (p_data#>>'{payload,end}')::timestamptz <= (p_data#>>'{payload,start}')::timestamptz) then raise exception 'INVALID_COVERAGE_INTERVAL'; end if;
   if p_data->>'kind'='user_link' then
     if not exists(select 1 from public.perfis where id=(p_data#>>'{payload,userId}')::uuid and status_usuario='APROVADO') or not exists(select 1 from public.colaboradores where id=(p_data->>'target')::uuid) then raise exception 'USER_LINK_INVALID'; end if;
     if exists(select 1 from public.monitoring_settings where kind='user_link' and revoked_at is null and payload->>'userId'=p_data#>>'{payload,userId}'
       and valid_from<=coalesce((p_data->>'validTo')::date,'9999-12-31') and coalesce(valid_to,'9999-12-31')>=(p_data->>'validFrom')::date) then raise exception 'USER_LINK_CONFLICT'; end if;
   end if;
   if p_data->>'kind'='schedule' and not exists(select 1 from public.colaboradores where id::text=p_data->>'target') then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
   start_date:=(p_data->>'validFrom')::date; end_date:=(p_data->>'validTo')::date;
   if p_data->>'kind' in ('schedule','mapping','rule','user_link','group_snapshot','evidence') and exists(select 1 from public.monitoring_settings s where s.kind=p_data->>'kind' and s.target=p_data->>'target' and s.revoked_at is null
    and s.valid_from<=coalesce(end_date,'9999-12-31') and coalesce(s.valid_to,'9999-12-31')>=start_date) then raise exception 'SETTING_VALIDITY_CONFLICT'; end if;
   insert into public.monitoring_settings(kind,target,valid_from,valid_to,payload,reason,created_by)
   values(p_data->>'kind',p_data->>'target',start_date,end_date,p_data->'payload',p_data->>'reason',actor) returning id into item;
   if p_data->>'kind' in ('schedule','group_snapshot','evidence','manual_event','user_link') or (p_data->>'kind'='policy' and p_data#>>'{payload,scope}'='person') then employee:=(p_data->>'target')::uuid; end if;
 elsif p_action='revoke_setting' then
   update public.monitoring_settings set revoked_at=now() where id=(p_data->>'id')::uuid and revoked_at is null returning id,valid_from,valid_to into item,start_date,end_date;
   if item is null then raise exception 'SETTING_NOT_FOUND'; end if;
 else raise exception 'UNKNOWN_ACTION'; end if;
 update private.monitoring_revision set version=version+1;
 update public.monitoring_results set dirty=true where active and (employee is null or employee_id=employee) and operational_date between start_date and coalesce(end_date,'9999-12-31');
 perform private.monitoring_enqueue(employee,start_date,end_date);
 insert into public.monitoring_audit(actor,action,target,detail) values(actor,p_action,item::text,jsonb_build_object('reason',coalesce(p_data->>'reason',p_data->>'evidence'),'validFrom',start_date,'validTo',end_date));
 return jsonb_build_object('ok',true,'id',item);
end $$;
revoke all on function private.monitoring_query_impl(text,jsonb) from public,anon,authenticated;
grant execute on function private.monitoring_query_impl(text,jsonb) to authenticated;
create function public.monitoring_query(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.monitoring_query_impl(p_action,p_data) $$;
revoke all on function public.monitoring_query(text,jsonb) from public,anon,authenticated;
grant execute on function public.monitoring_query(text,jsonb) to authenticated;

-- Results are computed by the server. Browser-authenticated roles cannot submit arbitrary totals.
create function private.monitoring_save_result_impl(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_version bigint; employee uuid:=(p_data->>'employeeId')::uuid; d date:=(p_data->>'date')::date;
begin
 select version into current_version from private.monitoring_revision for update;
 if current_version<>(p_data->>'version')::bigint then raise exception 'MONITORING_STALE_INPUT'; end if;
 update public.monitoring_results set active=false where employee_id=employee and operational_date=d and active;
 insert into public.monitoring_results(employee_id,operational_date,input_version,rule_version,result,summary,reason)
 values(employee,d,current_version,p_data->>'ruleVersion',p_data->'result',p_data->'summary',p_data->>'reason');
 insert into public.monitoring_audit(actor,action,target,detail) values((p_data->>'actor')::uuid,'reprocess',employee::text,jsonb_build_object('date',d,'version',current_version,'reason',p_data->>'reason'));
 delete from public.monitoring_jobs where employee_id=employee and operational_date=d;
 update private.monitoring_revision set results_version=results_version+1;
 return '{"ok":true}'::jsonb;
end $$;
revoke all on function private.monitoring_save_result_impl(jsonb) from public,anon,authenticated;
grant execute on function private.monitoring_save_result_impl(jsonb) to service_role;
create function public.monitoring_save_result(p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.monitoring_save_result_impl(p_data) $$;
revoke all on function public.monitoring_save_result(jsonb) from public,anon,authenticated;
grant execute on function public.monitoring_save_result(jsonb) to service_role;

create function private.monitoring_worker_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare output jsonb; job record; rows jsonb:='[]'::jsonb;
begin
 if p_action='claim' then
   for job in
    with candidates as (
     select j.employee_id,j.operational_date from public.monitoring_jobs j
     where j.operational_date<=(now() at time zone 'America/Sao_Paulo')::date and (j.leased_until is null or j.leased_until<now()) and exists(
      select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
      join public.monitoring_sources s on s.identity_namespace=bs.identity_namespace
      where b.employee_id=j.employee_id and (p_data->'sourceIds') ? s.id)
     order by j.created_at,j.employee_id,j.operational_date for update skip locked limit least(greatest(coalesce((p_data->>'limit')::integer,10),1),10)
    ) update public.monitoring_jobs j set lease_token=gen_random_uuid(),leased_until=now()+interval '5 minutes',attempts=attempts+1
      from candidates c where j.employee_id=c.employee_id and j.operational_date=c.operational_date returning j.*
   loop
    rows:=rows||jsonb_build_array(jsonb_build_object('employeeId',job.employee_id,'date',job.operational_date,'leaseToken',job.lease_token,'reason',job.reason,
      'input',private.monitoring_input(job.employee_id,job.operational_date,job.operational_date)));
   end loop;
   return jsonb_build_object('jobs',rows,'pending',(select count(*) from public.monitoring_jobs j where exists(
      select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id join public.monitoring_sources s on s.identity_namespace=bs.identity_namespace
      where b.employee_id=j.employee_id and (p_data->'sourceIds') ? s.id)));
 elsif p_action='finish' then
   perform 1 from public.monitoring_jobs where employee_id=(p_data->>'employeeId')::uuid and operational_date=(p_data->>'date')::date and lease_token=(p_data->>'leaseToken')::uuid and leased_until>now() for update;
   if not found then raise exception 'MONITORING_LEASE_LOST'; end if;
   output:=private.monitoring_save_result_impl(p_data);
   return output;
 elsif p_action='retry' then
   update public.monitoring_jobs set last_error=left(coalesce(p_data->>'code','REPROCESS_FAILED'),100),leased_until=now()+interval '1 minute',lease_token=null
   where employee_id=(p_data->>'employeeId')::uuid and operational_date=(p_data->>'date')::date and lease_token=(p_data->>'leaseToken')::uuid;
   return '{"ok":true}'::jsonb;
 else raise exception 'UNKNOWN_WORKER_ACTION'; end if;
end $$;
revoke all on function private.monitoring_worker_impl(text,jsonb) from public,anon,authenticated;
grant execute on function private.monitoring_worker_impl(text,jsonb) to service_role;
create function public.monitoring_worker(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.monitoring_worker_impl(p_action,p_data) $$;
revoke all on function public.monitoring_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.monitoring_worker(text,jsonb) to service_role;
