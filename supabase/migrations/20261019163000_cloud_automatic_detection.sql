-- Original bytes are uploaded privately before server-side classification.
alter table private.monitoring_cloud_jobs add column auto_detect boolean not null default false;
create table private.monitoring_cloud_routes (
 kind text not null check(kind in ('afd','defense-access','defense-person')),
 profile text not null check(profile in ('legacy','iso','workbook')),
 source_id text not null references public.monitoring_sources,
 primary key(kind,profile,source_id)
);
alter table private.monitoring_cloud_routes enable row level security;
revoke all on private.monitoring_cloud_routes from public,anon,authenticated,service_role;
insert into private.monitoring_cloud_routes(kind,profile,source_id)
select x.kind,x.profile,s.id from (values
 ('afd','legacy','ponto-legado-cd-jk'),('afd','iso','ponto-iso-cd-jk'),
 ('defense-access','workbook','defense-access-cd-jk'),('defense-person','workbook','defense-person-cd-jk')
) x(kind,profile,id) join public.monitoring_sources s on s.id=x.id and s.kind=x.kind;

-- Global create/routing lock provides identity serialization, including reroutes.
drop index private.monitoring_cloud_jobs_live_identity;
create index monitoring_cloud_jobs_live_identity on private.monitoring_cloud_jobs(source_id,sha256,parser_version)
 where status in ('uploading','queued','processing','completed');

do $$declare definition text;begin
 definition:=pg_get_functiondef('private.monitoring_cloud_json(private.monitoring_cloud_jobs,boolean)'::regprocedure);
 execute replace(definition,'''id'',p_job.id,','''autoDetect'',p_job.auto_detect,''id'',p_job.id,');
end $$;

alter function private.monitoring_cloud_admin_impl(text,jsonb) rename to monitoring_cloud_admin_before_detection;
create function private.monitoring_cloud_admin_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare output jsonb; job private.monitoring_cloud_jobs; object_bytes bigint;
begin
 if not exists(select 1 from public.perfis where id=(select auth.uid()) and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH')) then
  raise exception using errcode='42501',message='CLOUD_FORBIDDEN'; end if;
 if p_action='create' and p_data->>'autoDetect'='true' then
  perform pg_advisory_xact_lock(791704);
  select * into job from private.monitoring_cloud_jobs where sha256=p_data->>'sha256'
   and byte_length=(p_data->>'byteLength')::bigint and status in ('uploading','queued','processing','completed') order by created_at limit 1;
  if found then
   if to_regclass('storage.objects') is not null then
    execute 'select (metadata->>''size'')::bigint from storage.objects where bucket_id=$1 and name=$2' into object_bytes using 'monitoramento-originais',job.object_path;
   end if;
   return jsonb_build_object('job',private.monitoring_cloud_json(job),'uploadPresent',object_bytes is not distinct from job.byte_length);
  end if;
 end if;
 -- Failed, never ingested originals can be safely reclassified on retry.
 if p_action='retry' then
  perform pg_advisory_xact_lock(791704);
  select * into job from private.monitoring_cloud_jobs where id=(p_data->>'id')::uuid for update;
 end if;
 output:=private.monitoring_cloud_admin_before_detection(p_action,p_data);
 if (p_action='create' and p_data->>'autoDetect'='true') or (p_action='retry' and job.cursor=0 and job.last_error='CLOUD_AFD_PROFILE_MISMATCH') then
  update private.monitoring_cloud_jobs set auto_detect=true where id=(output#>>'{job,id}')::uuid returning * into job;
  output:=jsonb_set(output,'{job}',private.monitoring_cloud_json(job));
 end if;
 return output;
end $$;
revoke all on function private.monitoring_cloud_admin_impl(text,jsonb),private.monitoring_cloud_admin_before_detection(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_cloud_admin_impl(text,jsonb) to authenticated;

alter function private.monitoring_cloud_worker_impl(text,jsonb) rename to monitoring_cloud_worker_before_detection;
create function private.monitoring_cloud_worker_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.monitoring_cloud_jobs; v_source public.monitoring_sources; v_kind text:=p_data->>'kind'; v_profile text;
 candidates integer; selected_id text; previous_id text;
begin
 if p_action not in ('route','persist') then return private.monitoring_cloud_worker_before_detection(p_action,p_data); end if;
 perform pg_advisory_xact_lock(791704);
 select * into job from private.monitoring_cloud_jobs where id=(p_data->>'id')::uuid for update;
 if not found or job.status<>'processing' or job.lease_token is distinct from (p_data->>'leaseToken')::uuid or job.lease_expires_at<=clock_timestamp() then
  raise exception using errcode='PT409',message='CLOUD_LEASE_LOST'; end if;
 if p_action='persist' then
  if job.auto_detect then raise exception using errcode='PT409',message='CLOUD_DETECTION_REQUIRED'; end if;
  return private.monitoring_cloud_worker_before_detection(p_action,p_data);
 end if;
 if not job.auto_detect or job.cursor<>0 or job.plan is not null then raise exception using errcode='PT409',message='CLOUD_STATE'; end if;
 v_profile:=case when v_kind='afd' then p_data->>'afdProfile' else 'workbook' end;
 select count(*),min(r.source_id) into candidates,selected_id from private.monitoring_cloud_routes r
 join public.monitoring_sources s on s.id=r.source_id and s.active and s.kind=r.kind where r.kind=v_kind and r.profile=v_profile;
 if candidates<>1 then raise exception using errcode='PT409',message='CLOUD_ROUTE_AMBIGUOUS'; end if;
 select * into v_source from public.monitoring_sources where id=selected_id;
 previous_id:=job.source_id;
 update private.monitoring_cloud_jobs set source_id=v_source.id,source_contract=private.monitoring_cloud_source(v_source),
 source=private.monitoring_cloud_source(v_source)||case when v_kind='afd' then jsonb_build_object('afdProfile',v_profile,'encoding',case when v_profile='legacy' then 'latin1' else 'utf8' end) else '{}'::jsonb end,
 parser_version='monitoring-import/1.0.0/'||case when v_kind='afd' then 'afd-'||v_profile else v_kind end,
 auto_detect=false,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=job.id returning * into job;
 insert into public.monitoring_audit(actor,action,target,detail) values(null,'cloud_detected',job.id::text,
  jsonb_build_object('previousSourceId',previous_id,'sourceId',v_source.id,'kind',v_kind,'profile',v_profile));
 return jsonb_build_object('job',private.monitoring_cloud_json(job,true));
end $$;
revoke all on function private.monitoring_cloud_worker_impl(text,jsonb),private.monitoring_cloud_worker_before_detection(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_cloud_worker_impl(text,jsonb) to service_role;
