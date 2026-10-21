alter table public.monitoring_files add column archived_rows integer not null default 0 check(archived_rows>=0);
alter table private.monitoring_archive_files add column conflict_nsrs text[] not null default '{}' check(cardinality(conflict_nsrs)<=5000);

create function private.monitoring_archive_occurrence_payload(p_source text,p_row jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when (select active from private.monitoring_archive_control where id)
  and exists(select 1 from public.monitoring_sources where id=p_source and kind='afd')
 then jsonb_build_object('issues',coalesce((select jsonb_agg(i) from jsonb_array_elements(coalesce(p_row->'issues','[]')) i where i->>'severity'='error'),'[]'::jsonb),'originalPreserved',true)
  ||case when p_row->'event' is not null and p_row->'event'<>'null'::jsonb then '{"event":true}'::jsonb else '{}'::jsonb end
 else p_row end
$$;
revoke all on function private.monitoring_archive_occurrence_payload(text,jsonb) from public,anon,authenticated,service_role;

create function private.monitoring_archive_skip_cold(p_batch jsonb,p_row jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare context text;
begin
 if not (select active from private.monitoring_archive_control where id) or p_batch#>>'{source,kind}'<>'afd'
  or coalesce(p_row#>>'{event,type}','')<>'punch'
  or (p_row#>>'{event,timestamp}')::timestamptz>=((private.monitoring_archive_cutoff()-1)::timestamp at time zone 'America/Sao_Paulo') then return false;end if;
 context:=(p_batch#>>'{source,id}')||':'||(p_batch#>>'{file,sha256}')||':'||(p_batch#>>'{file,parserVersion}');
 if current_setting('app.monitoring_archive_cloud_file',true) is distinct from context then raise exception 'ARCHIVE_CLOUD_REQUIRED';end if;
 if not exists(select 1 from private.monitoring_archive_files where source_id=p_batch#>>'{source,id}' and sha256=p_batch#>>'{file,sha256}' and parser_version=p_batch#>>'{file,parserVersion}') then raise exception 'ARCHIVE_FILE_REQUIRED';end if;
 return true;
end $$;
revoke all on function private.monitoring_archive_skip_cold(jsonb,jsonb) from public,anon,authenticated,service_role;
create function private.monitoring_archive_cold_conflict(p_batch jsonb,p_row jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select (p_row#>>'{event,nsr}')=any(conflict_nsrs) from private.monitoring_archive_files
  where source_id=p_batch#>>'{source,id}' and sha256=p_batch#>>'{file,sha256}' and parser_version=p_batch#>>'{file,parserVersion}'),false)
$$;
revoke all on function private.monitoring_archive_cold_conflict(jsonb,jsonb) from public,anon,authenticated,service_role;

do $$declare definition text; needle text;replacement text;begin
 definition:=replace(pg_get_functiondef('private.monitoring_ingest_before_source_management(jsonb)'::regprocedure),E'\r\n',E'\n');
 needle:='v_batch_hash text;';if strpos(definition,needle)=0 then raise exception 'ARCHIVE_INGEST_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,needle||' v_archived integer:=0;');
 needle:=' for o in select value from jsonb_array_elements(p_data->''occurrences'') loop';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_INGEST_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,needle||E'\n   if private.monitoring_archive_skip_cold(p_data,o) then v_archived:=v_archived+1;v_added:=v_added+1;v_accepted:=v_accepted+1;v_rows:=v_rows+1;if private.monitoring_archive_cold_conflict(p_data,o) then v_conflicts:=v_conflicts+1;v_conflict_rows:=v_conflict_rows+1;end if;continue;end if;');
 needle:='values(f,o->>''key'',(o->>''line'')::integer,o->>''sheet'',o->>''payloadHash'',v_event,o,v_conflict)';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_INGEST_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,'values(f,o->>''key'',(o->>''line'')::integer,o->>''sheet'',o->>''payloadHash'',v_event,private.monitoring_archive_occurrence_payload(s,o),v_conflict)');
 needle:='accepted_rows=accepted_rows+v_accepted,new_events=new_events+v_new,';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_INGEST_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,needle||'archived_rows=archived_rows+v_archived,');
 needle:='where ev.id=any(v_batch_event_ids) and b.revoked_at is null';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_INGEST_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,needle||' and (not (select active from private.monitoring_archive_control where id) or (ev.occurred_at at time zone ''America/Sao_Paulo'')::date+delta.n>=private.monitoring_archive_cutoff())');
 needle:='and c.ativo_no_sistema and c.admissao is not null';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_INGEST_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,needle||' and (not (select active from private.monitoring_archive_control where id) or d::date>=private.monitoring_archive_cutoff())');
 execute definition;
end $$;

alter function private.monitoring_cloud_worker_impl(text,jsonb) rename to monitoring_cloud_worker_before_archive;
create function private.monitoring_cloud_worker_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.monitoring_cloud_jobs; previous_context text;answer jsonb;
begin
 if (select maintenance from private.monitoring_archive_control where id) then raise exception using errcode='PT503',message='ARCHIVE_MAINTENANCE';end if;
 if p_action='persist' then
  select * into job from private.monitoring_cloud_jobs where id=(p_data->>'id')::uuid;
  previous_context:=current_setting('app.monitoring_archive_cloud_file',true);
  perform set_config('app.monitoring_archive_cloud_file',job.source_id||':'||job.sha256||':'||job.parser_version,true);
 end if;
 answer:=private.monitoring_cloud_worker_before_archive(p_action,p_data);
 if p_action='persist' then perform set_config('app.monitoring_archive_cloud_file',coalesce(previous_context,''),true);end if;
 return answer;
end $$;
revoke all on function private.monitoring_cloud_worker_before_archive(text,jsonb),private.monitoring_cloud_worker_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_cloud_worker_impl(text,jsonb) to service_role;

alter function private.monitoring_enqueue(uuid,date,date,text) rename to monitoring_enqueue_before_archive;
create function private.monitoring_enqueue(p_employee uuid default null,p_start date default null,p_end date default null,p_source text default null) returns void
language plpgsql security definer set search_path='' as $$begin
 -- Explicit single-day RH corrections retain their existing behavior. Background
 -- broad invalidation never repopulates years of historical jobs.
 if (select active from private.monitoring_archive_control where id) and not(p_employee is not null and p_start is not null and p_end=p_start) then
  p_start:=greatest(coalesce(p_start,private.monitoring_archive_cutoff()),private.monitoring_archive_cutoff());
 end if;
 perform private.monitoring_enqueue_before_archive(p_employee,p_start,p_end,p_source);
end $$;
revoke all on function private.monitoring_enqueue_before_archive(uuid,date,date,text),private.monitoring_enqueue(uuid,date,date,text) from public,anon,authenticated,service_role;

alter function private.monitoring_input(uuid,date,date) rename to monitoring_input_before_archive;
create function private.monitoring_input(employee uuid,start_date date,end_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if (select maintenance from private.monitoring_archive_control where id) then raise exception using errcode='PT503',message='ARCHIVE_MAINTENANCE';end if;
 return private.monitoring_input_before_archive(employee,start_date,end_date);
end $$;
revoke all on function private.monitoring_input_before_archive(uuid,date,date),private.monitoring_input(uuid,date,date) from public,anon,authenticated,service_role;

alter function private.monitoring_query_impl(text,jsonb) rename to monitoring_query_before_archive;
create function private.monitoring_query_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if (select maintenance from private.monitoring_archive_control where id) then raise exception using errcode='PT503',message='ARCHIVE_MAINTENANCE';end if;
 return private.monitoring_query_before_archive(p_action,p_data);
end $$;
revoke all on function private.monitoring_query_before_archive(text,jsonb),private.monitoring_query_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_query_impl(text,jsonb) to authenticated;

alter function private.monitoring_cloud_json(private.monitoring_cloud_jobs,boolean) rename to monitoring_cloud_json_before_archive;
create function private.monitoring_cloud_json(p_job private.monitoring_cloud_jobs,p_lease boolean default false) returns jsonb language sql stable security definer set search_path='' as $$
 select private.monitoring_cloud_json_before_archive(p_job,p_lease)||jsonb_build_object('archivedRows',coalesce((select max(archived_rows) from public.monitoring_files where source_id=p_job.source_id and sha256=p_job.sha256 and parser_version=p_job.parser_version),0))
$$;
revoke all on function private.monitoring_cloud_json_before_archive(private.monitoring_cloud_jobs,boolean),private.monitoring_cloud_json(private.monitoring_cloud_jobs,boolean) from public,anon,authenticated,service_role;

alter function private.monitoring_archive_worker_impl(text,jsonb) rename to monitoring_archive_worker_before_runtime;
create function private.monitoring_archive_worker_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.monitoring_archive_control; item jsonb; object private.monitoring_archive_objects; f private.monitoring_archive_files; employee uuid; start_date date;end_date date;
begin
 select * into c from private.monitoring_archive_control where id;
 if p_action='policy' then return jsonb_build_object('active',c.active,'maintenance',c.maintenance,'cutoff',private.monitoring_archive_cutoff(),
  'eventFrom',((private.monitoring_archive_cutoff()-1)::timestamp at time zone 'America/Sao_Paulo'));
 elsif p_action='file' then
  return jsonb_build_object('file',(select to_jsonb(a) from private.monitoring_archive_files a where source_id=p_data->>'sourceId' and sha256=p_data->>'sha256' and parser_version=p_data->>'parserVersion'));
 elsif p_action='indices' then
  if jsonb_typeof(p_data->'shards') is distinct from 'array' or jsonb_array_length(p_data->'shards')>100 then raise exception 'ARCHIVE_INVALID';end if;
  return jsonb_build_object('objects',(select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('sourceId',i.source_id,'shard',i.shard,'rows',i.rows) order by i.shard,o.path),'[]')
   from private.monitoring_archive_indices i join private.monitoring_archive_objects o on o.path=i.path
   where i.source_id=p_data->>'sourceId' and i.shard in(select value::int from jsonb_array_elements_text(p_data->'shards'))));
 elsif p_action='register_index' then
  select * into object from private.monitoring_archive_objects where path=p_data->>'path' and kind='nsr_index';
  if object.path is null or object.metadata->>'sourceId' is distinct from p_data->>'sourceId'
   or (object.metadata->>'shard')::int is distinct from (p_data->>'shard')::int or (object.metadata->>'rows')::int is distinct from (p_data->>'rows')::int then raise exception 'ARCHIVE_INDEX_INVALID';end if;
  insert into private.monitoring_archive_indices(source_id,shard,path,rows) values(p_data->>'sourceId',(p_data->>'shard')::int,object.path,(p_data->>'rows')::int) on conflict do nothing;
  return '{"ok":true}';
 elsif p_action='register_file' then
  select * into object from private.monitoring_archive_objects where path=p_data->>'manifestPath' and kind='manifest';
  if object.path is null or object.metadata->>'sourceId' is distinct from p_data->>'sourceId' or object.metadata->>'fileSha256' is distinct from p_data->>'sha256'
   or object.metadata->>'parserVersion' is distinct from p_data->>'parserVersion' or object.metadata->>'type'<>'afd-file'
   or not exists(select 1 from private.monitoring_archive_objects o where o.kind='original' and o.expanded_sha256=p_data->>'sha256' and o.metadata->>'sourceId'=p_data->>'sourceId') then raise exception 'ARCHIVE_FILE_REQUIRED';end if;
  insert into private.monitoring_archive_files(source_id,sha256,parser_version,manifest_path,rows,punches,conflict_nsrs)
   values(p_data->>'sourceId',p_data->>'sha256',p_data->>'parserVersion',object.path,(p_data->>'rows')::int,(p_data->>'punches')::int,
    array(select jsonb_array_elements_text(coalesce(p_data->'conflictNsrs','[]'::jsonb)))) on conflict do nothing;
  select * into strict f from private.monitoring_archive_files where source_id=p_data->>'sourceId' and sha256=p_data->>'sha256' and parser_version=p_data->>'parserVersion';
  if f.rows<>(p_data->>'rows')::int or f.punches<>(p_data->>'punches')::int then raise exception 'ARCHIVE_FILE_IMMUTABLE';end if;
  return jsonb_build_object('ok',true,'file',to_jsonb(f));
 elsif p_action='history_scope' then
  employee:=(p_data->>'employeeId')::uuid;start_date:=(p_data->>'start')::date;end_date:=(p_data->>'end')::date;
  if employee is null or start_date is null or end_date is null or end_date<start_date or end_date-start_date>368 then raise exception 'ARCHIVE_INVALID';end if;
  return jsonb_build_object('active',c.active,'maintenance',c.maintenance,'cutoff',private.monitoring_archive_cutoff(),
   'bindings',(select coalesce(jsonb_agg(distinct jsonb_build_object('sourceId',es.id,'identityType',b.identity_type,'identityValue',b.identity_value,'validFrom',b.valid_from,'validTo',b.valid_to)),'[]')
    from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id join public.monitoring_sources es on es.identity_namespace=bs.identity_namespace
    where b.employee_id=employee and b.revoked_at is null and b.identity_type in ('cpf','pis') and es.kind='afd' and b.valid_from<=end_date and coalesce(b.valid_to,'9999-12-31')>=start_date),
   'objects',(select coalesce(jsonb_agg(to_jsonb(o) order by o.path),'[]') from private.monitoring_archive_objects o where o.kind='nsr_index'
    and (o.metadata->>'minAt')::timestamptz<(end_date+2)::timestamp at time zone 'America/Sao_Paulo' and (o.metadata->>'maxAt')::timestamptz>=(start_date-1)::timestamp at time zone 'America/Sao_Paulo'
    and exists(select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id join public.monitoring_sources es on es.identity_namespace=bs.identity_namespace
     where b.employee_id=employee and b.revoked_at is null and b.identity_type in ('cpf','pis') and es.id=o.metadata->>'sourceId'
      and b.valid_from<=end_date and coalesce(b.valid_to,'9999-12-31')>=start_date
      and o.metadata->'identityHashes' ? encode(sha256(convert_to(b.identity_type||':'||b.identity_value,'UTF8')),'hex'))),
   'files',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'sourceId',source_id,'sha256',sha256)),'[]') from public.monitoring_files));
 end if;
 return private.monitoring_archive_worker_before_runtime(p_action,p_data);
end $$;
revoke all on function private.monitoring_archive_worker_before_runtime(text,jsonb),private.monitoring_archive_worker_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_archive_worker_impl(text,jsonb) to service_role;
