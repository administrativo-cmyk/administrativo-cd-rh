-- Live queue progress derives from actual authorized employee/day keys. It is
-- separate from evidence quality: a finished calculation may still be partial.
create function private.monitoring_processing_progress(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());role_name public.papel_usuario;start_date date:=(p_data->>'start')::date;
 end_date date:=(p_data->>'end')::date;answer jsonb;
begin
 select papel_usuario into role_name from public.perfis where id=actor and status_usuario='APROVADO';
 if actor is null or role_name is null then raise exception using errcode='42501',message='MONITORING_FORBIDDEN';end if;
 if start_date is null or end_date is null or not isfinite(start_date) or not isfinite(end_date)
  or end_date<start_date or end_date-start_date>366 then raise exception 'INVALID_PERIOD';end if;
 with people as materialized(
  select c.id from public.colaboradores c join public.unidades u on u.id=c.unidade_id
  where private.monitoring_can_read(c.id)
   and (coalesce(p_data->>'employeeId','')='' or c.id::text=p_data->>'employeeId')
   and (coalesce(p_data->>'unit','')='' or u.codigo=p_data->>'unit')
   and (coalesce(p_data->>'managerId','')='' or c.gestor_id::text=p_data->>'managerId')
   and (coalesce(p_data->>'query','')='' or c.nome ilike '%'||(p_data->>'query')||'%' or c.matricula=p_data->>'query')
 ), keys as(
  select employee_id,operational_date from public.monitoring_results r join people p on p.id=r.employee_id
   where r.active and r.operational_date between start_date and end_date
  union
  select employee_id,operational_date from public.monitoring_jobs j join people p on p.id=j.employee_id
   where j.operational_date between start_date and end_date
 ), days as materialized(
  select k.*,r.id result_id,r.dirty,r.computed_at,r.summary,
   j.employee_id is not null queued,j.last_error,
   j.lease_token is not null and j.leased_until>now() running,
   k.operational_date>(now() at time zone 'America/Sao_Paulo')::date
    or coalesce(j.employee_id is not null and j.lease_token is null and j.last_error is null and j.leased_until>now(),false) deferred
  from keys k left join public.monitoring_results r on r.employee_id=k.employee_id and r.operational_date=k.operational_date and r.active
   left join public.monitoring_jobs j on j.employee_id=k.employee_id and j.operational_date=k.operational_date
 ), counts as(
  select count(*)filter(where not deferred) total,
   count(*)filter(where not deferred and not queued and not coalesce(dirty,true)) completed,
   count(*)filter(where not deferred and (queued or coalesce(dirty,true))) pending,
   count(*)filter(where deferred) deferred,count(*)filter(where running) running,
   count(*)filter(where last_error is not null) failed,
   count(*)filter(where not deferred and not queued and not coalesce(dirty,true) and coalesce(summary->>'quality','pending') in('pending','unavailable','partial')) limited,
   max(computed_at) last_calculation
  from days
 ), latest as materialized(select * from private.monitoring_cloud_jobs order by created_at desc limit 3)
 select jsonb_build_object('checkedAt',clock_timestamp(),'datasetVersion',(select version::text||':'||results_version::text from private.monitoring_revision),
  'start',start_date,'end',end_date,'total',c.total,'completed',c.completed,'pending',c.pending,'running',c.running,'deferred',c.deferred,
  'failed',c.failed,'limited',c.limited,'lastCalculationAt',c.last_calculation,
  'withoutData',(select count(*) from people p where not exists(select 1 from keys k where k.employee_id=p.id)),
  'activeImports',case when role_name in('ADMIN','RH') then (select count(*) from private.monitoring_cloud_jobs where status in('uploading','queued','processing')) else null end,
  'imports',case when role_name in('ADMIN','RH') then coalesce((select jsonb_agg(jsonb_build_object('id',id,'fileName',file_name,'status',status,
   'processedRows',processed_rows,'totalRows',total_rows,'completedAt',completed_at) order by created_at desc) from latest),'[]'::jsonb) else '[]'::jsonb end)
 into answer from counts c;
 return answer;
end $$;
revoke all on function private.monitoring_processing_progress(jsonb) from public,anon,authenticated,service_role;

do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.monitoring_query_impl(text,jsonb)'::regprocedure);
 needle:='return private.monitoring_query_before_archive(p_action,p_data);';
 if strpos(definition,needle)=0 then raise exception 'MONITORING_PROGRESS_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,'if p_action=''progress'' then return private.monitoring_processing_progress(p_data);end if;'||chr(10)||needle);
 -- New imports must not wait behind a two-month historical backfill. The same
 -- fencing, retry and eligibility checks still govern every claimed job.
 definition:=pg_get_functiondef('private.monitoring_worker_before_import_gate(text,jsonb)'::regprocedure);
 needle:='order by j.created_at,j.employee_id,j.operational_date for update skip locked';
 if strpos(definition,needle)=0 then raise exception 'MONITORING_PROGRESS_WORKER_CHANGED';end if;
 execute replace(definition,needle,'order by j.operational_date desc,j.created_at,j.employee_id for update skip locked');
end $$;
