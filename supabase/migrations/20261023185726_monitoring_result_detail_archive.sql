-- Full calculated timelines live in verified private cloud objects. The hot
-- projection retains every field consumed by SQL quality/Banco de Horas reads.
create function private.monitoring_result_projection(full_result jsonb,p_path text,p_id uuid) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('workMs',full_result->'workMs',
  'journey',jsonb_build_object('status',full_result#>'{journey,status}'),
  'outsideOperation',jsonb_build_object('quality',full_result#>'{outsideOperation,quality}','milliseconds',full_result#>'{outsideOperation,milliseconds}'),
  'cafeteria',jsonb_build_object('quality',full_result#>'{cafeteria,quality}','milliseconds',full_result#>'{cafeteria,milliseconds}'),
  'lateness',jsonb_build_object('quality',full_result#>'{lateness,quality}','totalMs',full_result#>'{lateness,totalMs}'),
  'archiveDetail',jsonb_build_object('path',p_path,'id',p_id,'sha256',encode(sha256(convert_to(full_result::text,'UTF8')),'hex')))
$$;
revoke all on function private.monitoring_result_projection(jsonb,text,uuid) from public,anon,authenticated,service_role;

alter function private.monitoring_archive_worker_impl(text,jsonb) rename to monitoring_archive_worker_before_details;
create function private.monitoring_archive_worker_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.monitoring_archive_control;object private.monitoring_archive_objects;raw text;rows jsonb;n bigint;expected integer;
begin
 if p_action not in ('details_page','details_commit','details_objects') then return private.monitoring_archive_worker_before_details(p_action,p_data);end if;
 select * into c from private.monitoring_archive_control where id;
 if not c.active or c.maintenance then raise exception 'ARCHIVE_STATE';end if;
 if p_action='details_objects' then
  if jsonb_typeof(p_data->'paths')<>'array' or jsonb_array_length(p_data->'paths')>367 then raise exception 'ARCHIVE_ARGUMENTS_INVALID';end if;
  return jsonb_build_object('objects',coalesce((select jsonb_agg(to_jsonb(o)) from private.monitoring_archive_objects o
   where o.path in(select jsonb_array_elements_text(p_data->'paths')) and o.kind='snapshot' and o.metadata->>'type'='result-details'),'[]'::jsonb));
 elsif p_action='details_page' then
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'raw',q.result::text) order by q.id),'[]') into rows from
   (select id,result from public.monitoring_results where not result ? 'archiveDetail' order by id limit 250) q;
  if jsonb_array_length(rows)=0 then return '{"rows":0}';end if;
  raw:=jsonb_build_object('table','public.monitoring_result_details','rows',rows)::text;
  return jsonb_build_object('table','public.monitoring_result_details','raw',raw,'rows',jsonb_array_length(rows),'sha256',encode(sha256(convert_to(raw,'UTF8')),'hex'));
 end if;
 perform pg_advisory_xact_lock(791704);
 select * into object from private.monitoring_archive_objects where path=p_data->>'path' and kind='snapshot' and metadata->>'type'='result-details';
 if object.path is null then raise exception 'ARCHIVE_OBJECT_NOT_STORED';end if;
 raw:=p_data->>'raw';rows:=(raw::jsonb)->'rows';expected:=jsonb_array_length(rows);
 if raw::jsonb->>'table' is distinct from 'public.monitoring_result_details' or expected not between 1 and 250
  or encode(sha256(convert_to(raw,'UTF8')),'hex') is distinct from object.expanded_sha256
  or object.metadata->>'table' is distinct from 'public.monitoring_result_details' then raise exception 'ARCHIVE_RESTORE_MISMATCH';end if;
 -- Fence reprocessing with row locks. A correction invalidates the whole page.
 perform 1 from public.monitoring_results r join jsonb_array_elements(rows) x on r.id=(x->>'id')::uuid order by r.id for update of r;
 select count(*) into n from public.monitoring_results r join jsonb_array_elements(rows) x on r.id=(x->>'id')::uuid
  where r.result=(x->>'raw')::jsonb or r.result=private.monitoring_result_projection((x->>'raw')::jsonb,object.path,r.id);
 if n<>expected then return '{"ok":false,"stale":true}';end if;
 update public.monitoring_results r set result=private.monitoring_result_projection((x->>'raw')::jsonb,object.path,r.id)
  from jsonb_array_elements(rows) x where r.id=(x->>'id')::uuid and not r.result ? 'archiveDetail';
 get diagnostics n=row_count;
 return jsonb_build_object('ok',true,'rows',n,'replayed',n=0);
end $$;
revoke all on function private.monitoring_archive_worker_before_details(text,jsonb),private.monitoring_archive_worker_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_archive_worker_impl(text,jsonb) to service_role;
