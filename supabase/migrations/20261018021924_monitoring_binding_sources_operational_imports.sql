-- Explicit revisions, source management and reviewed operational imports.
alter table public.monitoring_bindings add column updated_at timestamptz not null default clock_timestamp(),
 add column revision integer not null default 1 check(revision>0),
 add column supersedes_id uuid unique references public.monitoring_bindings(id);
create trigger monitoring_binding_touch before update on public.monitoring_bindings for each row execute function private.administration_touch();
alter table public.monitoring_sources add column active boolean not null default true,
 add column label text check(length(label) between 1 and 100),
 add column configuration_updated_at timestamptz not null default clock_timestamp(),
 add column managed boolean not null default false;

create function private.monitoring_identifier_valid(value text,kind text) returns boolean
language plpgsql immutable set search_path='' as $$
declare total integer:=0; digit integer; i integer; weights integer[]:=array[3,2,9,8,7,6,5,4,3,2];
begin
 if kind='defense' then return coalesce(length(btrim(value)) between 1 and 100,false); end if;
 if kind is null or kind not in ('cpf','pis') or value is null or value!~'^[0-9]{11}$' or value=repeat(left(value,1),11) then return false; end if;
 if kind='pis' then
  for i in 1..10 loop total:=total+substring(value,i,1)::integer*weights[i]; end loop;
  digit:=11-total%11; if digit>=10 then digit:=0; end if;
  return digit=right(value,1)::integer;
 end if;
 for i in 1..9 loop total:=total+substring(value,i,1)::integer*(11-i); end loop;
 digit:=(total*10)%11; if digit=10 then digit:=0; end if;
 if digit<>substring(value,10,1)::integer then return false; end if;
 total:=0;
 for i in 1..10 loop total:=total+substring(value,i,1)::integer*(12-i); end loop;
 digit:=(total*10)%11; if digit=10 then digit:=0; end if;
 return digit=right(value,1)::integer;
end $$;
revoke all on function private.monitoring_identifier_valid(text,text) from public,anon,authenticated,service_role;

-- Queue a proposed identity before its binding row exists and before acquiring revision.
create function private.monitoring_prepare_identity(p_employee uuid,p_source text,p_kind text,p_value text,p_start date,p_end date,p_configuration jsonb default null) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.monitoring_jobs(employee_id,operational_date,reason)
 select p_employee,q.target_date,'Identidade ou cobertura revisada' from (
  select distinct (e.occurred_at at time zone 'America/Sao_Paulo')::date+delta.n as target_date
  from public.monitoring_events e join public.monitoring_sources s on s.id=e.source_id cross join (values(-1),(0),(1)) delta(n)
  where s.identity_namespace=(select identity_namespace from public.monitoring_sources where id=p_source) and e.identity_type=p_kind and e.identity_value=p_value
   and (e.occurred_at at time zone 'America/Sao_Paulo')::date between p_start and coalesce(p_end,'9999-12-31')
   and (e.occurred_at at time zone 'America/Sao_Paulo')::date+delta.n between p_start and coalesce(p_end,'9999-12-31')
  union
  select d::date from public.monitoring_sources s join public.colaboradores c on c.id=p_employee
  cross join lateral (select case when s.id=p_source and p_configuration is not null then p_configuration else s.configuration end config) configuration
  cross join lateral generate_series(greatest((config#>>'{declaredCoverage,from}')::timestamptz at time zone 'America/Sao_Paulo',p_start::timestamp,c.admissao::timestamp),
    least((config#>>'{declaredCoverage,to}')::timestamptz at time zone 'America/Sao_Paulo',coalesce(p_end,'9999-12-31')::timestamp,(now() at time zone 'America/Sao_Paulo')::date::timestamp),interval '1 day') d
  where s.identity_namespace=(select identity_namespace from public.monitoring_sources where id=p_source) and p_kind in ('cpf','pis') and s.kind='afd'
   and config->>'sourceIdentityConfirmed'='true' and config#>>'{declaredCoverage,continuous}'='true' and c.ativo_no_sistema and c.admissao is not null
   and exists(select 1 from public.monitoring_settings ms where ms.kind='schedule' and ms.target=p_employee::text and ms.revoked_at is null and ms.valid_from<=d::date and (ms.valid_to is null or ms.valid_to>=d::date) and ms.payload->'days' @> to_jsonb(array[extract(dow from d)::integer]))
 ) q order by q.target_date on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
end $$;
revoke all on function private.monitoring_prepare_identity(uuid,text,text,text,date,date,jsonb) from public,anon,authenticated,service_role;

create function private.monitoring_binding_change_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.monitoring_bindings; fresh jsonb; result public.monitoring_bindings;
 expected timestamptz; employee uuid; start_date date; end_date date; source public.monitoring_sources; reason text; target_employee uuid;
begin
 if not exists(select 1 from public.perfis where id=actor and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH')) then raise exception using errcode='42501',message='BINDING_FORBIDDEN'; end if;
 if p_action is null or p_action not in ('create','replace','restore','revoke') then raise exception 'BINDING_INVALID'; end if;
 perform pg_advisory_xact_lock(824202609,1); perform pg_advisory_xact_lock(791800,1); perform pg_advisory_xact_lock(791701); perform pg_advisory_xact_lock(791704);
 perform 1 from public.perfis where id=actor and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH') for share;
 if not found then raise exception using errcode='42501',message='BINDING_FORBIDDEN'; end if;
 if p_action='create' then fresh:=p_data; reason:=btrim(p_data->>'evidence');
 else
  expected:=(p_data->>'expectedUpdatedAt')::timestamptz;
  select * into previous from public.monitoring_bindings where id=(p_data->>'id')::uuid;
  if not found then raise exception 'BINDING_NOT_FOUND'; end if;
  if expected is null or expected<>previous.updated_at then raise exception 'BINDING_STALE'; end if;
  if exists(select 1 from public.monitoring_bindings where supersedes_id=previous.id) then raise exception 'BINDING_SUPERSEDED'; end if;
  if (p_action='restore' and previous.revoked_at is null) or (p_action<>'restore' and previous.revoked_at is not null) then raise exception 'BINDING_STALE'; end if;
  reason:=btrim(p_data->>'reason');
  fresh:=case when p_action='replace' then p_data->'binding' else jsonb_build_object('sourceId',previous.source_id,'identityType',previous.identity_type,'identityValue',previous.identity_value,'employeeId',previous.employee_id,'validFrom',previous.valid_from,'validTo',previous.valid_to,'evidence',previous.evidence) end;
 end if;
 if coalesce(length(reason),0) not between 5 and 1000 then raise exception 'BINDING_INVALID'; end if;
 employee:=(fresh->>'employeeId')::uuid;start_date:=(fresh->>'validFrom')::date;end_date:=(fresh->>'validTo')::date;
 select * into source from public.monitoring_sources where id=fresh->>'sourceId';
 if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
 if p_action<>'revoke' then
  if not source.active then raise exception 'SOURCE_DISABLED'; end if;
  if not private.monitoring_identifier_valid(fresh->>'identityValue',fresh->>'identityType')
   or (source.kind='afd' and fresh->>'identityType' not in ('cpf','pis')) or (source.kind<>'afd' and fresh->>'identityType'<>'defense')
   or not exists(select 1 from public.colaboradores where id=employee and ativo_no_sistema)
   or start_date is null or not isfinite(start_date) or (end_date is not null and (not isfinite(end_date) or end_date<start_date))
   or coalesce(length(btrim(fresh->>'evidence')),0) not between 5 and 1000 then raise exception 'BINDING_INVALID'; end if;
  if exists(select 1 from public.monitoring_bindings b join public.monitoring_sources s on s.id=b.source_id
    where s.identity_namespace=source.identity_namespace and b.identity_type=fresh->>'identityType' and b.identity_value=fresh->>'identityValue'
     and b.revoked_at is null and b.id is distinct from previous.id and b.valid_from<=coalesce(end_date,'9999-12-31') and coalesce(b.valid_to,'9999-12-31')>=start_date) then raise exception 'IDENTITY_VALIDITY_CONFLICT'; end if;
 end if;
 -- All affected job locks precede the revision and binding rows, including employee changes.
 for target_employee in select distinct x from unnest(array[previous.employee_id,employee]) x where x is not null order by x loop
  perform private.monitoring_prepare_setting_change(target_employee,least(previous.valid_from,start_date),case when previous.id is null then end_date when previous.valid_to is null or end_date is null then null else greatest(previous.valid_to,end_date) end);
  if target_employee=employee and p_action<>'revoke' then perform private.monitoring_prepare_identity(employee,source.id,fresh->>'identityType',fresh->>'identityValue',start_date,end_date); end if;
 end loop;
 perform 1 from private.monitoring_revision where id=true for update;
 if previous.id is not null then
  perform 1 from public.monitoring_bindings where id=previous.id and updated_at=expected for update;
  if not found then raise exception 'BINDING_STALE'; end if;
  if p_action<>'restore' then update public.monitoring_bindings set revoked_at=clock_timestamp() where id=previous.id returning * into result; end if;
 end if;
 if p_action<>'revoke' then
  insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,valid_to,evidence,created_by,revision,supersedes_id)
   values(source.id,fresh->>'identityType',fresh->>'identityValue',employee,start_date,end_date,btrim(fresh->>'evidence'),actor,coalesce(previous.revision,0)+1,previous.id) returning * into result;
 end if;
 update private.monitoring_revision set version=version+1 where id=true;
 update public.monitoring_results set dirty=true where active and employee_id=any(array[employee,previous.employee_id])
  and operational_date>=least(start_date,previous.valid_from) and (end_date is null or previous.valid_to is null or operational_date<=greatest(end_date,previous.valid_to));
 insert into public.monitoring_audit(actor,action,target,detail) values(actor,p_action||'_binding',result.id::text,jsonb_build_object('reason',reason,'before',to_jsonb(previous),'after',to_jsonb(result)));
 return jsonb_build_object('ok',true,'id',result.id,'record',to_jsonb(result));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or not_null_violation or check_violation then raise exception 'BINDING_INVALID';
end $$;
revoke all on function private.monitoring_binding_change_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_binding_change_impl(text,jsonb) to authenticated;
create function public.monitoring_binding_change(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.monitoring_binding_change_impl(p_action,p_data)$$;
revoke all on function public.monitoring_binding_change(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.monitoring_binding_change(text,jsonb) to authenticated;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('private.monitoring_query_impl(text,jsonb)'::regprocedure);
 if strpos(definition,'elsif p_action=''bind'' then')=0 or strpos(definition,'elsif p_action=''revoke_binding'' then')=0 then raise exception 'BINDING_DEFINITION_CHANGED'; end if;
 definition:=replace(definition,'elsif p_action=''bind'' then','elsif p_action=''bind'' then return private.monitoring_binding_change_impl(''create'',p_data);');
 definition:=replace(definition,'elsif p_action=''revoke_binding'' then','elsif p_action=''revoke_binding'' then return private.monitoring_binding_change_impl(''revoke'',p_data);');
 execute definition;
end $$;

create function private.monitoring_sources_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); old public.monitoring_sources; output public.monitoring_sources; sid text:=p_data->>'id';
 config jsonb; expected timestamptz; source_used boolean; employee uuid; binding public.monitoring_bindings; reason text:=btrim(p_data->>'reason');
begin
 if not exists(select 1 from public.perfis where id=actor and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH')) then raise exception using errcode='42501',message='SOURCE_FORBIDDEN'; end if;
 if p_action='list' then return jsonb_build_object('sources',(select coalesce(jsonb_agg(to_jsonb(s) order by coalesce(label,id)),'[]') from public.monitoring_sources s)); end if;
 if p_action is null or p_action<>'save' or sid!~'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' or sid is null
  or coalesce(length(reason),0) not between 5 and 1000 or coalesce(length(btrim(p_data->>'label')),0) not between 1 and 100
  or coalesce(p_data->>'kind','') not in ('afd','defense-access','defense-person')
  or not exists(select 1 from pg_timezone_names where name=p_data->>'timeZone')
  or coalesce(p_data->>'identityNamespace','')!~'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
  or jsonb_typeof(p_data->'active') is distinct from 'boolean' or jsonb_typeof(p_data->'sourceIdentityConfirmed') is distinct from 'boolean' then raise exception 'SOURCE_INVALID'; end if;
 perform pg_advisory_xact_lock(824202609,1); perform pg_advisory_xact_lock(791800,1); perform pg_advisory_xact_lock(791701); perform pg_advisory_xact_lock(791704);
 perform 1 from public.perfis where id=actor and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH') for share;
 if not found then raise exception using errcode='42501',message='SOURCE_FORBIDDEN'; end if;
 select * into old from public.monitoring_sources where id=sid; expected:=(p_data->>'expectedUpdatedAt')::timestamptz;
 if (old.id is not null and (expected is null or expected<>old.configuration_updated_at)) or (old.id is null and expected is not null) then raise exception 'SOURCE_STALE'; end if;
 source_used:=exists(select 1 from public.monitoring_files where source_id=sid) or exists(select 1 from public.monitoring_bindings where source_id=sid) or exists(select 1 from public.monitoring_people where source_id=sid);
 if source_used and (old.kind is distinct from p_data->>'kind' or old.timezone is distinct from p_data->>'timeZone' or old.identity_namespace is distinct from p_data->>'identityNamespace') then raise exception 'SOURCE_CONTRACT_IMMUTABLE'; end if;
 config:=jsonb_build_object('id',sid,'kind',p_data->>'kind','timeZone',p_data->>'timeZone','identityNamespace',p_data->>'identityNamespace','sourceIdentityConfirmed',(p_data->>'sourceIdentityConfirmed')::boolean);
 if p_data->'declaredCoverage' is not null and p_data->'declaredCoverage'<>'null' then
  if jsonb_typeof(p_data->'declaredCoverage')<>'object' or jsonb_typeof(p_data#>'{declaredCoverage,continuous}') is distinct from 'boolean'
   or coalesce(p_data#>>'{declaredCoverage,from}','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(p_data#>>'{declaredCoverage,to}','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$'
   or not isfinite((p_data#>>'{declaredCoverage,from}')::timestamptz) or not isfinite((p_data#>>'{declaredCoverage,to}')::timestamptz)
   or (p_data#>>'{declaredCoverage,to}')::timestamptz<=(p_data#>>'{declaredCoverage,from}')::timestamptz then raise exception 'SOURCE_INVALID'; end if;
  config:=config||jsonb_build_object('declaredCoverage',jsonb_build_object('from',p_data#>>'{declaredCoverage,from}','to',p_data#>>'{declaredCoverage,to}','continuous',(p_data#>>'{declaredCoverage,continuous}')::boolean));
 end if;
 if old.id is not null and old.configuration is distinct from config then
  for employee in select distinct b.employee_id from public.monitoring_bindings b join public.monitoring_sources s on s.id=b.source_id where s.identity_namespace=old.identity_namespace and b.revoked_at is null order by b.employee_id loop
   perform private.monitoring_prepare_setting_change(employee,'0001-01-01',null);
   for binding in select b.* from public.monitoring_bindings b join public.monitoring_sources s on s.id=b.source_id where b.employee_id=employee and b.revoked_at is null and s.identity_namespace=old.identity_namespace order by b.id loop
    perform private.monitoring_prepare_identity(employee,sid,binding.identity_type,binding.identity_value,binding.valid_from,binding.valid_to,config);
   end loop;
  end loop;
  perform 1 from private.monitoring_revision where id=true for update;
  update private.monitoring_revision set version=version+1 where id=true;
  update public.monitoring_results r set dirty=true where r.active and exists(select 1 from public.monitoring_bindings b join public.monitoring_sources s on s.id=b.source_id where b.employee_id=r.employee_id and b.revoked_at is null and s.identity_namespace=old.identity_namespace);
 end if;
 insert into public.monitoring_sources(id,kind,timezone,identity_namespace,label,active,configuration,managed)
 values(sid,p_data->>'kind',p_data->>'timeZone',p_data->>'identityNamespace',btrim(p_data->>'label'),(p_data->>'active')::boolean,config,true)
 on conflict(id) do update set kind=excluded.kind,timezone=excluded.timezone,identity_namespace=excluded.identity_namespace,label=excluded.label,active=excluded.active,configuration=excluded.configuration,managed=true,configuration_updated_at=greatest(clock_timestamp(),monitoring_sources.configuration_updated_at+interval '1 microsecond') returning * into output;
 insert into public.monitoring_audit(actor,action,target,detail) values(actor,'save_source',sid,jsonb_build_object('reason',reason,'before',to_jsonb(old),'after',to_jsonb(output)));
 return jsonb_build_object('record',to_jsonb(output));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'SOURCE_INVALID';
end $$;
revoke all on function private.monitoring_sources_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_sources_impl(text,jsonb) to authenticated;
create function public.monitoring_sources_admin(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.monitoring_sources_impl(p_action,p_data)$$;
revoke all on function public.monitoring_sources_admin(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.monitoring_sources_admin(text,jsonb) to authenticated;
create function private.monitoring_worker_sources_impl(p_ids text[]) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('sources',coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind',s.kind,'timeZone',s.timezone,'identityNamespace',s.identity_namespace,'active',s.active,'configurationUpdatedAt',s.configuration_updated_at,'sourceIdentityConfirmed',coalesce((s.configuration->>'sourceIdentityConfirmed')::boolean,false),'declaredCoverage',s.configuration->'declaredCoverage') order by s.id),'[]'))
 from public.monitoring_sources s where s.id=any(p_ids) and cardinality(p_ids)<=100
$$;
revoke all on function private.monitoring_worker_sources_impl(text[]) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_worker_sources_impl(text[]) to service_role;
create function public.monitoring_worker_sources(p_ids text[]) returns jsonb language sql security invoker set search_path='' as $$select private.monitoring_worker_sources_impl(p_ids)$$;
revoke all on function public.monitoring_worker_sources(text[]) from public,anon,authenticated,service_role;
grant execute on function public.monitoring_worker_sources(text[]) to service_role;
-- Guard every ingest operation in SQL too; UI-managed coverage cannot be overwritten by a stale worker.
alter function private.monitoring_ingest_impl(jsonb) rename to monitoring_ingest_before_source_management;
revoke all on function private.monitoring_ingest_before_source_management(jsonb) from public,anon,authenticated,service_role;
create function private.monitoring_ingest_impl(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid text:=coalesce(p_data#>>'{heartbeat,sourceId}',p_data#>>'{failure,sourceId}',p_data#>>'{photo,sourceId}',p_data#>>'{source,id}'); source public.monitoring_sources;
begin
 perform pg_advisory_xact_lock(791704);
 select * into source from public.monitoring_sources where id=sid;
 if source.id is not null and not source.active then raise exception 'SOURCE_DISABLED'; end if;
 if source.managed then
  if p_data#>'{heartbeat,source}' is not null then
   if p_data#>>'{heartbeat,source,kind}' is distinct from source.kind or p_data#>>'{heartbeat,source,timeZone}' is distinct from source.timezone or coalesce(p_data#>>'{heartbeat,source,identityNamespace}',sid) is distinct from source.identity_namespace then raise exception 'SOURCE_CONTRACT_IMMUTABLE'; end if;
   p_data:=jsonb_set(p_data,'{heartbeat,source}',source.configuration);
  elsif p_data->'source' is not null then
   if p_data#>>'{source,kind}' is distinct from source.kind or p_data#>>'{source,timeZone}' is distinct from source.timezone or coalesce(p_data#>>'{source,identityNamespace}',sid) is distinct from source.identity_namespace then raise exception 'SOURCE_CONTRACT_IMMUTABLE'; end if;
   p_data:=jsonb_set(p_data,'{source}',source.configuration);
  end if;
 end if;
 return private.monitoring_ingest_before_source_management(p_data);
end $$;
revoke all on function private.monitoring_ingest_impl(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_ingest_impl(jsonb) to service_role;
-- SQL wrappers bind function OIDs: recreate after the private function rename.
create or replace function public.monitoring_ingest(p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.monitoring_ingest_impl(p_data)$$;

create table private.operational_import_batches (
 id uuid primary key default gen_random_uuid(), actor uuid not null references public.perfis(id), kind text not null check(kind in ('clock','bank')),
 fingerprint text not null, metadata jsonb not null, defaults jsonb not null, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '7 days',
 unique(actor,kind,fingerprint)
);
create table private.operational_import_rows (
 batch_id uuid not null references private.operational_import_batches(id), line integer not null check(line>0),
 input jsonb not null, employee_id uuid references public.colaboradores(id), employee_version timestamptz,
 errors jsonb not null default '[]', state text not null check(state in ('ready','blocked','applied','failed')),
 result jsonb, primary key(batch_id,line)
);
create index operational_import_rows_employee on private.operational_import_rows(employee_id);
alter table private.operational_import_batches enable row level security;
alter table private.operational_import_rows enable row level security;
revoke all on private.operational_import_batches,private.operational_import_rows from public,anon,authenticated,service_role;
create trigger operational_import_batch_touch before update on private.operational_import_batches for each row execute function private.administration_touch();
create function private.operational_import_name(value text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(lower(translate(btrim(value),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç','AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),'[[:space:]]+',' ','g')
$$;
revoke all on function private.operational_import_name(text) from public,anon,authenticated,service_role;
create function private.operational_import_snapshot(batch uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',b.id,'kind',b.kind,'updatedAt',b.updated_at,'expiresAt',b.expires_at,'metadata',b.metadata,'defaults',b.defaults,
  'rows',coalesce((select jsonb_agg(jsonb_build_object('line',r.line,'input',r.input,'employeeId',r.employee_id,'employeeName',c.nome,'employeeNumber',c.matricula,'errors',r.errors,'state',r.state,'result',r.result) order by r.line)
   from private.operational_import_rows r left join public.colaboradores c on c.id=r.employee_id where r.batch_id=b.id),'[]')) from private.operational_import_batches b where b.id=batch
$$;
revoke all on function private.operational_import_snapshot(uuid) from public,anon,authenticated,service_role;
create function private.operational_import_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); batch private.operational_import_batches; row_value jsonb; item private.operational_import_rows;
 employee public.colaboradores; input jsonb; problems jsonb; line_number integer; v_fingerprint text; row_result jsonb; selected integer[];
 identity_kind text; v_identity_value text; binding_id uuid; existing public.monitoring_bindings; failure text; reason text; defaults jsonb; count_rows integer;
begin
 if not exists(select 1 from public.perfis where id=actor and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH')) then raise exception using errcode='42501',message='IMPORT_FORBIDDEN'; end if;
 if p_action in ('preview','confirm') then
  perform pg_advisory_xact_lock(824202609,1); perform pg_advisory_xact_lock(791800,1);
  perform 1 from public.perfis where id=actor and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH') for share;
  if not found then raise exception using errcode='42501',message='IMPORT_FORBIDDEN'; end if;
 end if;
 if p_action='preview' then
  if coalesce(p_data->>'kind','') not in ('clock','bank') or jsonb_typeof(p_data->'rows') is distinct from 'array' or jsonb_array_length(p_data->'rows') not between 1 and 2000
   or coalesce(p_data#>>'{metadata,sha256}','')!~'^[a-f0-9]{64}$' or coalesce(length(p_data#>>'{metadata,fileName}'),0) not between 1 and 200 then raise exception 'IMPORT_INVALID'; end if;
  defaults:=p_data->'defaults';reason:=btrim(defaults->>'reason');
  if coalesce(length(reason),0) not between 5 and 1000 then raise exception 'IMPORT_INVALID'; end if;
  if p_data->>'kind'='clock' and (not exists(select 1 from public.monitoring_sources where id=defaults->>'sourceId' and kind='afd' and active)
   or nullif(defaults->>'validFrom','') is null or not isfinite((defaults->>'validFrom')::date) or (defaults->>'validTo' is not null and (not isfinite((defaults->>'validTo')::date) or (defaults->>'validTo')::date<(defaults->>'validFrom')::date))) then raise exception 'IMPORT_INVALID'; end if;
  v_fingerprint:=encode(sha256(convert_to((p_data-'rows')::text|| (p_data->'rows')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(791805);
  select * into batch from private.operational_import_batches where operational_import_batches.actor=auth.uid() and kind=p_data->>'kind' and operational_import_batches.fingerprint=v_fingerprint;
  if found then
   -- A new preview refreshes pending matches after RH corrections or expiry.
   -- Applied rows remain immutable, even when the same file is uploaded again.
   update private.operational_import_batches set expires_at=clock_timestamp()+interval '7 days' where id=batch.id returning * into batch;
  else insert into private.operational_import_batches(actor,kind,fingerprint,metadata,defaults) values(actor,p_data->>'kind',v_fingerprint,p_data->'metadata',defaults) returning * into batch; end if;
  for row_value in select value from jsonb_array_elements(p_data->'rows') loop
   line_number:=(row_value->>'line')::integer;input:=row_value->'input';problems:=coalesce(row_value->'errors','[]');
   if line_number is null or line_number<1 or jsonb_typeof(input) is distinct from 'object' or jsonb_typeof(problems) is distinct from 'array' or jsonb_array_length(problems)>20 then raise exception 'IMPORT_INVALID'; end if;
   if exists(select 1 from jsonb_object_keys(input) key where key not in ('employeeNumber','name','cpf','pis','measurementDate','effectiveFrom','workdayHours','balanceMinutes')) then raise exception 'IMPORT_INVALID'; end if;
   select * into employee from public.colaboradores where matricula=input->>'employeeNumber' and ativo_no_sistema;
   if not found then problems:=problems||'"MATRICULA_NAO_ENCONTRADA"'::jsonb;
   elsif batch.kind='clock' and nullif(btrim(input->>'name'),'') is null then problems:=problems||'"NOME_OBRIGATORIO"'::jsonb;
   elsif nullif(btrim(input->>'name'),'') is not null and private.operational_import_name(input->>'name') is distinct from private.operational_import_name(employee.nome) then problems:=problems||'"NOME_DIVERGENTE"'::jsonb; end if;
   if batch.kind='clock' then
    if nullif(input->>'cpf','') is null and nullif(input->>'pis','') is null then problems:=problems||'"CPF_OU_PIS_OBRIGATORIO"'::jsonb; end if;
    foreach identity_kind in array array['cpf','pis'] loop
     v_identity_value:=nullif(input->>identity_kind,'');
     if v_identity_value is not null and not private.monitoring_identifier_valid(v_identity_value,identity_kind) then problems:=problems||to_jsonb(upper(identity_kind)||'_INVALIDO'); end if;
    end loop;
   else
    begin
     if nullif(input->>'measurementDate','') is null or not isfinite((input->>'measurementDate')::date)
      or nullif(input->>'effectiveFrom','') is null or not isfinite((input->>'effectiveFrom')::date)
      or (input->>'workdayHours')::numeric<=0 or (input->>'workdayHours')::numeric>24 or scale((input->>'workdayHours')::numeric)>4 or round((input->>'workdayHours')::numeric*60)<1
      or nullif(input->>'workdayHours','') is null or nullif(input->>'balanceMinutes','') is null or (input->>'balanceMinutes')!~'^-?[0-9]+$' or (input->>'balanceMinutes')::bigint not between -10000000 and 10000000 then problems:=problems||'"MEDICAO_INVALIDA"'::jsonb; end if;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then problems:=problems||'"MEDICAO_INVALIDA"'::jsonb; end;
   end if;
   insert into private.operational_import_rows(batch_id,line,input,employee_id,employee_version,errors,state)
    values(batch.id,line_number,input,employee.id,employee.updated_at,problems,case when jsonb_array_length(problems)=0 then 'ready' else 'blocked' end)
    on conflict(batch_id,line) do update set input=excluded.input,employee_id=excluded.employee_id,employee_version=excluded.employee_version,errors=excluded.errors,state=excluded.state,result=null where operational_import_rows.state<>'applied';
  end loop;
  -- Duplicate employee/identity rows require file correction instead of choosing one silently.
  update private.operational_import_rows r set state='blocked',errors=errors||'"LINHA_DUPLICADA"'::jsonb where batch_id=batch.id and state<>'applied' and exists(
   select 1 from private.operational_import_rows other where other.batch_id=r.batch_id and other.line<>r.line and
    ((other.input->>'employeeNumber'=r.input->>'employeeNumber' and (batch.kind='clock' or other.input->>'effectiveFrom'=r.input->>'effectiveFrom'))
     or (batch.kind='clock' and (nullif(other.input->>'cpf','')=nullif(r.input->>'cpf','') or nullif(other.input->>'pis','')=nullif(r.input->>'pis','')))));
  insert into public.monitoring_audit(actor,action,target,detail) values(actor,'preview_'||batch.kind||'_import',batch.id::text,jsonb_build_object('reason',reason,'rows',jsonb_array_length(p_data->'rows'),'fileSha256',p_data#>>'{metadata,sha256}'));
 elsif p_action in ('get','confirm') then
  select * into batch from private.operational_import_batches where id=(p_data->>'id')::uuid and operational_import_batches.actor=auth.uid() for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if p_action='get' then return private.operational_import_snapshot(batch.id); end if;
  if batch.expires_at<clock_timestamp() then raise exception 'IMPORT_EXPIRED'; end if;
  if jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines') not between 1 and 200 then raise exception 'IMPORT_INVALID'; end if;
  select array_agg(distinct value::integer) into selected from jsonb_array_elements_text(p_data->'lines');
  select count(*) into count_rows from private.operational_import_rows where batch_id=batch.id and line=any(selected);
  if count_rows<>cardinality(selected) then raise exception 'IMPORT_INVALID'; end if;
  if not exists(select 1 from private.operational_import_rows where batch_id=batch.id and line=any(selected) and state<>'applied') then return private.operational_import_snapshot(batch.id); end if;
  if (p_data->>'expectedUpdatedAt')::timestamptz is distinct from batch.updated_at then raise exception 'IMPORT_STALE'; end if;
  -- Order actor/global locks before per-row individual RPCs. No public rows are written outside those RPCs.
  perform pg_advisory_xact_lock(791701);perform pg_advisory_xact_lock(791803);perform pg_advisory_xact_lock(791704);
  perform 1 from public.perfis where id=actor and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH') for share;
  if not found then raise exception using errcode='42501',message='IMPORT_FORBIDDEN'; end if;
  -- Prequeue the union of selected people before the first individual call locks revision.
  for item in select distinct on(employee_id) * from private.operational_import_rows where batch_id=batch.id and line=any(selected) and state in ('ready','failed') order by employee_id,line loop
   if batch.kind='bank' then perform private.time_bank_prepare_reprocess(item.employee_id,'0001-01-01'); else perform private.monitoring_prepare_setting_change(item.employee_id,'0001-01-01',null); end if;
   if batch.kind='clock' then
    foreach identity_kind in array array['cpf','pis'] loop
     if nullif(item.input->>identity_kind,'') is not null then perform private.monitoring_prepare_identity(item.employee_id,batch.defaults->>'sourceId',identity_kind,item.input->>identity_kind,(batch.defaults->>'validFrom')::date,(batch.defaults->>'validTo')::date); end if;
    end loop;
   end if;
  end loop;
  for item in select * from private.operational_import_rows where batch_id=batch.id and line=any(selected) and state in ('ready','failed') order by employee_id,line loop
   begin
    select * into employee from public.colaboradores where id=item.employee_id and ativo_no_sistema;
    if not found or employee.updated_at<>item.employee_version then raise exception 'IMPORT_EMPLOYEE_CHANGED'; end if;
    if batch.kind='bank' then
     row_result:=private.time_bank_admin_impl('save',item.input||jsonb_build_object('employeeId',item.employee_id,'reason',batch.defaults->>'reason','source',left('Importação revisada '||batch.id::text,200)));
    else
     row_result:='[]';
     foreach identity_kind in array array['cpf','pis'] loop
      v_identity_value:=nullif(item.input->>identity_kind,'');
      if v_identity_value is not null then
       select b.* into existing from public.monitoring_bindings b join public.monitoring_sources s on s.id=b.source_id where b.revoked_at is null and s.identity_namespace=(select identity_namespace from public.monitoring_sources where id=batch.defaults->>'sourceId') and b.identity_type=identity_kind and b.identity_value=v_identity_value and b.employee_id=item.employee_id and b.valid_from=(batch.defaults->>'validFrom')::date and b.valid_to is not distinct from (batch.defaults->>'validTo')::date;
       if found then row_result:=row_result||jsonb_build_object('id',existing.id,'alreadyApplied',true);
       else
        row_result:=row_result||private.monitoring_binding_change_impl('create',jsonb_build_object('sourceId',batch.defaults->>'sourceId','identityType',identity_kind,'identityValue',v_identity_value,'employeeId',item.employee_id,'validFrom',batch.defaults->>'validFrom','validTo',batch.defaults->>'validTo','evidence',batch.defaults->>'reason'));
       end if;
      end if;
     end loop;
    end if;
    update private.operational_import_rows set state='applied',errors='[]',result=row_result where batch_id=batch.id and line=item.line;
   exception when others then
    failure:=case when sqlerrm in ('IMPORT_EMPLOYEE_CHANGED','IDENTITY_VALIDITY_CONFLICT','BINDING_INVALID','SOURCE_DISABLED','BANK_ADMIN_BASELINE_CONFLICT','BANK_ADMIN_INVALID','BANK_ADMIN_FORBIDDEN') then sqlerrm else 'IMPORT_ROW_FAILED' end;
    update private.operational_import_rows set state='failed',errors=jsonb_build_array(failure),result=null where batch_id=batch.id and line=item.line;
   end;
  end loop;
  update private.operational_import_batches set updated_at=clock_timestamp() where id=batch.id;
  insert into public.monitoring_audit(actor,action,target,detail) values(actor,'confirm_'||batch.kind||'_import',batch.id::text,jsonb_build_object('reason',batch.defaults->>'reason','selectedLines',to_jsonb(selected)));
 else raise exception 'IMPORT_INVALID'; end if;
 return private.operational_import_snapshot(batch.id);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or not_null_violation or check_violation or unique_violation then raise exception 'IMPORT_INVALID';
end $$;
revoke all on function private.operational_import_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.operational_import_impl(text,jsonb) to authenticated;
create function public.operational_import(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.operational_import_impl(p_action,p_data)$$;
revoke all on function public.operational_import(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.operational_import(text,jsonb) to authenticated;

-- Entry helpers run before job/revision locks. Serialize with ingestion here,
-- never inside enqueue itself, which workers can call while holding a job.
do $$declare signature text;definition text;marker text;marker_crlf text;newline text;occurrences integer;occurrences_crlf integer;begin
 foreach signature in array array['private.monitoring_prepare_setting_change(uuid,date,date)','private.time_bank_prepare_reprocess(uuid,date)','private.monitoring_worker_impl(text,jsonb)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  -- SQL editors can preserve CRLF in the stored body. Match only the exact
  -- expected entry instruction in either line-ending form, never loose whitespace.
  marker:=case signature
   when 'private.monitoring_prepare_setting_change(uuid,date,date)' then E'begin\n perform private.monitoring_enqueue(p_employee,p_start,p_end,null);'
   when 'private.time_bank_prepare_reprocess(uuid,date)' then E'begin\n perform private.monitoring_enqueue(p_employee,p_start,null,null);'
   when 'private.monitoring_worker_impl(text,jsonb)' then E'begin\n if p_action=''claim'' then'
  end;
  marker_crlf:=replace(marker,E'\n',E'\r\n');
  occurrences:=(length(definition)-length(replace(definition,marker,'')))/length(marker);
  occurrences_crlf:=(length(definition)-length(replace(definition,marker_crlf,'')))/length(marker_crlf);
  if occurrences+occurrences_crlf<>1 or strpos(definition,'pg_advisory_xact_lock(791704)')>0 then raise exception 'OPERATION_PREPARE_DEFINITION_CHANGED: %',signature;end if;
  newline:=case when occurrences=1 then E'\n' else E'\r\n' end;
  if occurrences_crlf=1 then marker:=marker_crlf;end if;
  execute overlay(definition placing 'begin'||newline||' perform pg_advisory_xact_lock(791704);'||newline from strpos(definition,marker) for length('begin'||newline));
 end loop;
end$$;
