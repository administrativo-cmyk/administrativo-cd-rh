-- A clock configured with CPF can export the legacy date layout as well as ISO.
update public.monitoring_sources set label=case id when 'ponto-iso-cd-jk' then 'Relógio CPF' else 'Relógio PIS' end
 where (id='ponto-iso-cd-jk' and label='Relógio CPF (AFD ISO)') or (id='ponto-legado-cd-jk' and label='Relógio PIS (AFD legado)');
alter table private.monitoring_cloud_routes add column identity_type text not null default '' check(identity_type in ('','cpf','pis'));
update private.monitoring_cloud_routes set identity_type=case profile when 'legacy' then 'pis' else 'cpf' end where kind='afd';
insert into private.monitoring_cloud_routes(kind,profile,source_id,identity_type)
 select 'afd','legacy',s.id,'cpf' from public.monitoring_sources s where id='ponto-iso-cd-jk' and kind='afd';
insert into private.monitoring_cloud_routes(kind,profile,source_id,identity_type)
 select 'afd','iso',s.id,'pis' from public.monitoring_sources s where id='ponto-legado-cd-jk' and kind='afd';

alter function private.monitoring_cloud_worker_impl(text,jsonb) rename to monitoring_cloud_worker_before_identity;
create function private.monitoring_cloud_worker_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.monitoring_cloud_jobs; v_source public.monitoring_sources; v_kind text:=p_data->>'kind';v_profile text;v_identity text;
 candidates integer;selected_id text;previous_id text;
begin
 if p_action<>'route' then return private.monitoring_cloud_worker_before_identity(p_action,p_data);end if;
 perform pg_advisory_xact_lock(791704);
 select * into job from private.monitoring_cloud_jobs where id=(p_data->>'id')::uuid for update;
 if not found or job.status<>'processing' or job.lease_token is distinct from (p_data->>'leaseToken')::uuid or job.lease_expires_at<=clock_timestamp() then
  raise exception using errcode='PT409',message='CLOUD_LEASE_LOST';end if;
 if not job.auto_detect or job.cursor<>0 or job.plan is not null then raise exception using errcode='PT409',message='CLOUD_STATE';end if;
 v_profile:=case when v_kind='afd' then p_data->>'afdProfile' else 'workbook' end;
 v_identity:=case when v_kind='afd' then p_data->>'afdIdentityType' else '' end;
 if v_kind='afd' and (v_identity is null or v_identity not in ('cpf','pis')) then raise exception using errcode='PT409',message='CLOUD_IDENTITY_TYPE_REQUIRED';end if;
 select count(*),min(r.source_id) into candidates,selected_id from private.monitoring_cloud_routes r
 join public.monitoring_sources s on s.id=r.source_id and s.active and s.kind=r.kind where r.kind=v_kind and r.profile=v_profile and r.identity_type=v_identity;
 if candidates<>1 then raise exception using errcode='PT409',message='CLOUD_ROUTE_AMBIGUOUS';end if;
 select * into v_source from public.monitoring_sources where id=selected_id;
 previous_id:=job.source_id;
 update private.monitoring_cloud_jobs set source_id=v_source.id,source_contract=private.monitoring_cloud_source(v_source),
 source=private.monitoring_cloud_source(v_source)||case when v_kind='afd' then jsonb_build_object('afdProfile',v_profile,'afdIdentityType',v_identity,'encoding',case when v_profile='legacy' then 'latin1' else 'utf8' end) else '{}'::jsonb end,
 parser_version='monitoring-import/1.0.0/'||case when v_kind='afd' then 'afd-'||v_profile||case when v_identity=case when v_profile='legacy' then 'pis' else 'cpf' end then '' else '-'||v_identity end else v_kind end,
 auto_detect=false,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=job.id returning * into job;
 insert into public.monitoring_audit(actor,action,target,detail) values(null,'cloud_detected',job.id::text,
  jsonb_build_object('previousSourceId',previous_id,'sourceId',v_source.id,'kind',v_kind,'profile',v_profile,'identityType',v_identity));
 return jsonb_build_object('job',private.monitoring_cloud_json(job,true));
end $$;
revoke all on function private.monitoring_cloud_worker_impl(text,jsonb),private.monitoring_cloud_worker_before_identity(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_cloud_worker_impl(text,jsonb) to service_role;

-- Only two representations of the SAME clock/NSR/person/minute can be equivalent.
-- Conflicting NSRs within the same layout retain the existing conflict behavior.
create function private.monitoring_cross_format_punch_equal(a jsonb,b jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(a->>'type'='punch' and b->>'type'='punch' and a->>'nsr'=b->>'nsr' and a->>'key'=b->>'key'
 and a->'identity'=b->'identity' and a#>>'{identity,type}' in ('cpf','pis')
 and a->>'device'=b->>'device' and a->>'classification'=b->>'classification' and a->>'eligible'=b->>'eligible'
 and ((a#>>'{original,profile}'='legacy' and b#>>'{original,profile}'='iso' and (a->>'precisionSeconds')::numeric=60 and (b->>'precisionSeconds')::numeric=1)
  or (a#>>'{original,profile}'='iso' and b#>>'{original,profile}'='legacy' and (a->>'precisionSeconds')::numeric=1 and (b->>'precisionSeconds')::numeric=60))
 and floor(extract(epoch from (a->>'timestamp')::timestamptz)/60)=floor(extract(epoch from (b->>'timestamp')::timestamptz)/60),false)
$$;
revoke all on function private.monitoring_cross_format_punch_equal(jsonb,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare item record;definition text;needle text;matches integer:=0;
begin
 for item in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname like 'monitoring_ingest%' loop
  definition:=pg_get_functiondef(item.oid);
  needle:='select id,(event_type=''punch'' and payload_hash<>o->>''payloadHash'') into v_event,v_conflict';
  if strpos(definition,needle)=0 then continue;end if;
  matches:=matches+1;
  definition:=replace(definition,'v_conflicts integer:=0;','v_conflicts integer:=0; v_refined integer:=0;');
  definition:=replace(definition,needle,'select id,(event_type=''punch'' and payload_hash<>o->>''payloadHash'' and not private.monitoring_cross_format_punch_equal(payload,e)) into v_event,v_conflict');
  needle:='if v_conflict then update public.monitoring_events';
  if strpos(definition,needle)=0 then raise exception 'AFD_CONFLICT_DEFINITION_CHANGED';end if;
  definition:=replace(definition,needle,$body$
   if not v_conflict then
    -- Preserve the more precise canonical timestamp. Every raw occurrence keeps its own bytes/hash.
    update public.monitoring_events set payload=e,payload_hash=o->>'payloadHash',occurred_at=(e->>'timestamp')::timestamptz
    where id=v_event and not conflicted and private.monitoring_cross_format_punch_equal(payload,e)
     and (payload->>'precisionSeconds')::numeric>(e->>'precisionSeconds')::numeric;
    if found then v_refined:=v_refined+1;end if;
   end if;
   if v_conflict then update public.monitoring_events$body$);
  definition:=replace(definition,'if v_new>0 or v_conflicts>0 then','if v_new>0 or v_conflicts>0 or v_refined>0 then');
  execute definition;
 end loop;
 if matches<>1 then raise exception 'AFD_INGEST_DEFINITION_CHANGED: %',matches;end if;
end $patch$;
