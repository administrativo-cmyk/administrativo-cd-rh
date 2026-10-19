-- Automatic aliases are system actions, distinct from manually confirmed links.
alter table public.monitoring_bindings alter column created_by drop not null;
alter table public.monitoring_bindings add column origin text not null default 'manual' check(origin in ('manual','cloud_document'));
alter table public.monitoring_bindings add constraint monitoring_binding_creator check(
 (origin='manual' and created_by is not null) or (origin='cloud_document' and created_by is null));
alter table private.monitoring_cloud_jobs add column review_version integer not null default 0 check(review_version between 0 and 1);

do $json$
declare definition text;needle text:='''completedAt'',p_job.completed_at)';
begin
 definition:=pg_get_functiondef('private.monitoring_cloud_json(private.monitoring_cloud_jobs,boolean)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'CLOUD_JSON_DEFINITION_CHANGED';end if;
 definition:=replace(definition,'IMMUTABLE','STABLE');
 execute replace(definition,needle,$body$'completedAt',p_job.completed_at,'reviewVersion',p_job.review_version,'rejectedRows',coalesce((
 select f.rejected_rows from public.monitoring_files f where f.source_id=p_job.source_id and f.sha256=p_job.sha256 and f.parser_version=p_job.parser_version),0))$body$);
end $json$;

alter function private.monitoring_cloud_admin_impl(text,jsonb) rename to monitoring_cloud_admin_before_review;
create function private.monitoring_cloud_admin_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());job private.monitoring_cloud_jobs;before_value jsonb;
begin
 if p_action<>'reinspect' then return private.monitoring_cloud_admin_before_review(p_action,p_data);end if;
 perform 1 from public.perfis where id=actor and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH') for share;
 if not found then raise exception using errcode='42501',message='CLOUD_FORBIDDEN';end if;
 perform pg_advisory_xact_lock(791704);
 select * into job from private.monitoring_cloud_jobs where id=(p_data->>'id')::uuid for update;
 if not found then raise exception using errcode='PT404',message='CLOUD_NOT_FOUND';end if;
 if job.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz then raise exception using errcode='PT409',message='CLOUD_STALE';end if;
 if job.status<>'completed' or job.review_version<>0 or job.source->>'kind'<>'afd' or not exists(
  select 1 from public.monitoring_files f where f.source_id=job.source_id and f.sha256=job.sha256 and f.parser_version=job.parser_version and f.rejected_rows>0)
 then raise exception using errcode='PT409',message='CLOUD_RETRY_UNAVAILABLE';end if;
 if (select count(*) from private.monitoring_cloud_jobs where status in ('uploading','queued','processing'))>=100
  or (select count(*) from private.monitoring_cloud_jobs where created_by=actor and status in ('uploading','queued','processing'))>=10
 then raise exception using errcode='PT409',message='CLOUD_QUOTA';end if;
 before_value:=private.monitoring_cloud_json(job);
 update private.monitoring_cloud_jobs set status='queued',auto_detect=true,review_version=1,parser_version='monitoring-import/auto-review',
 cursor=0,processed_rows=0,total_rows=null,total_batches=null,plan=null,last_batch_hash=null,last_batch_result=null,attempts=0,retry_pending=true,
 lease_token=null,lease_expires_at=null,next_retry_at=clock_timestamp(),last_error=null,completed_at=null,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
 where id=job.id returning * into job;
 insert into public.monitoring_audit(actor,action,target,detail) values(actor,'cloud_reinspect',job.id::text,
 jsonb_build_object('reason','Reavaliar identificadores com leitor atualizado; original preservado','before',before_value,'after',private.monitoring_cloud_json(job)));
 return jsonb_build_object('job',private.monitoring_cloud_json(job));
end $$;
revoke all on function private.monitoring_cloud_admin_impl(text,jsonb),private.monitoring_cloud_admin_before_review(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_cloud_admin_impl(text,jsonb) to authenticated;

alter function private.monitoring_cloud_worker_impl(text,jsonb) rename to monitoring_cloud_worker_before_documents;
create function private.monitoring_cloud_worker_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare output jsonb;job private.monitoring_cloud_jobs;v_source public.monitoring_sources;item jsonb;employee uuid;admitted date;observed date;first_day date;
 identity_kind text;v_identity_value text;binding_id uuid;added integer:=0;
begin
 if p_action<>'route' then return private.monitoring_cloud_worker_before_documents(p_action,p_data);end if;
 -- Same lock order as binding management and the attendance worker.
 perform pg_advisory_xact_lock(824202609,1);perform pg_advisory_xact_lock(791800,1);perform pg_advisory_xact_lock(791701);perform pg_advisory_xact_lock(791704);
 output:=private.monitoring_cloud_worker_before_documents(p_action,p_data);
 select * into job from private.monitoring_cloud_jobs where id=(output#>>'{job,id}')::uuid for update;
 if job.source->>'kind'<>'afd' or coalesce(p_data->>'afdAllowAlternate','false')<>'true' then return output;end if;
 if jsonb_typeof(p_data->'identifiers') is distinct from 'array' or jsonb_array_length(p_data->'identifiers')>5000 then raise exception using errcode='PT400',message='CLOUD_INVALID';end if;
 select * into v_source from public.monitoring_sources where id=job.source_id;
 update private.monitoring_cloud_jobs set source=jsonb_set(source,'{afdAllowAlternate}','true'),parser_version=parser_version||'-alternate' where id=job.id returning * into job;
 if v_source.active and v_source.configuration->>'sourceIdentityConfirmed'='true' then
  for item in select value from jsonb_array_elements(p_data->'identifiers') loop
   identity_kind:=item->>'type';v_identity_value:=item->>'value';observed:=(item->>'observedOn')::date;
   if identity_kind not in ('cpf','pis') or not private.monitoring_identifier_valid(v_identity_value,identity_kind) or observed is null or not isfinite(observed) then raise exception using errcode='PT400',message='CLOUD_INVALID';end if;
   -- Exact canonical documents only. Never overwrite, extend or restore any existing link.
   if exists(select 1 from public.monitoring_bindings b join public.monitoring_sources s on s.id=b.source_id where s.identity_namespace=v_source.identity_namespace and b.identity_type=identity_kind and b.identity_value=v_identity_value) then continue;end if;
   select i.employee_id,c.admissao into employee,admitted from private.employee_identifiers i join public.colaboradores c on c.id=i.employee_id
    where (case identity_kind when 'cpf' then i.cpf else i.pis end)=v_identity_value and c.ativo_no_sistema;
   if employee is null or admitted is null then continue;end if;
   first_day:=greatest(admitted,observed);
   perform private.monitoring_enqueue(employee,first_day,null,v_source.id);
   insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by,origin)
    values(v_source.id,identity_kind,v_identity_value,employee,first_day,'Documento válido e único no cadastro RH; vínculo automático entre relógios',null,'cloud_document') returning id into binding_id;
   insert into public.monitoring_audit(actor,action,target,detail) values(null,'cloud_document_binding',binding_id::text,
    jsonb_build_object('employeeId',employee,'sourceId',v_source.id,'identityType',identity_kind,'validFrom',first_day,'jobId',job.id,'reason','Documento válido e único no cadastro RH; sem substituir vínculo existente'));
   update public.monitoring_results set dirty=true where employee_id=employee and active and operational_date>=first_day;
   added:=added+1;
  end loop;
 end if;
 if added>0 then update private.monitoring_revision set version=version+1 where id=true;end if;
 return jsonb_build_object('job',private.monitoring_cloud_json(job,true));
end $$;
revoke all on function private.monitoring_cloud_worker_impl(text,jsonb),private.monitoring_cloud_worker_before_documents(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_cloud_worker_impl(text,jsonb) to service_role;

-- A clean reread of the identical original supersedes old parser rejections for
-- collection readiness, while retaining every previous file/occurrence/audit row.
do $coverage$
declare item record;definition text;needle text;matches integer:=0;
begin
 needle:='not exists(select 1 from public.monitoring_files f where f.source_id=s.id and (f.status<>''complete'' or f.rejected_rows>0 or f.conflict_rows>0))';
 for item in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'daily_call_evidence%' loop
  definition:=pg_get_functiondef(item.oid);if strpos(definition,needle)=0 then continue;end if;matches:=matches+1;
  execute replace(definition,needle,$body$not exists(select 1 from public.monitoring_files f where f.source_id=s.id and (f.status<>'complete' or f.rejected_rows>0 or f.conflict_rows>0)
   and not exists(select 1 from public.monitoring_files clean where clean.source_id=f.source_id and clean.sha256=f.sha256 and clean.byte_length=f.byte_length
    and clean.parser_version<>f.parser_version and clean.status='complete' and clean.completed_at is not null and clean.rejected_rows=0 and clean.conflict_rows=0))$body$);
 end loop;
 if matches<>1 then raise exception 'CLOUD_COVERAGE_DEFINITION_CHANGED: %',matches;end if;
end $coverage$;
