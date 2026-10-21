create table private.monitoring_archive_restore_batches (
 run_id uuid not null references private.monitoring_archive_snapshots, table_name text not null,
 path text not null references private.monitoring_archive_objects, rows integer not null check(rows>0),
 restored_at timestamptz not null default clock_timestamp(),primary key(run_id,path)
);
alter table private.monitoring_archive_restore_batches enable row level security;
revoke all on private.monitoring_archive_restore_batches from public,anon,authenticated,service_role;
alter function private.monitoring_archive_worker_impl(text,jsonb) rename to monitoring_archive_worker_before_rebuild;
create function private.monitoring_archive_worker_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.monitoring_archive_control; snap private.monitoring_archive_snapshots; object private.monitoring_archive_objects;
 tables constant text[]:=array['public.monitoring_events','public.monitoring_occurrences','public.monitoring_results','public.monitoring_jobs'];
 t text;n bigint;expected bigint;body jsonb;keys text[];names text;answer jsonb;item record;raw_hash text;
begin
 if p_action not in ('rebuild_plan','rebuild_start','restore','rebuild_status','activate') then return private.monitoring_archive_worker_before_rebuild(p_action,p_data);end if;
 select * into c from private.monitoring_archive_control where id for update;
 if p_action='activate' and c.active and not c.maintenance then return jsonb_build_object('ok',true,'alreadyActive',true,'databaseBytes',pg_database_size(current_database()));end if;
 if not c.maintenance or c.run_id is distinct from (p_data->>'runId')::uuid then raise exception 'ARCHIVE_RUN_REQUIRED';end if;
 select * into strict snap from private.monitoring_archive_snapshots where id=c.run_id for update;
 if p_action='rebuild_plan' then
  if snap.state<>'sealed' then raise exception 'ARCHIVE_STATE';end if;
  select * into object from private.monitoring_archive_objects where path=p_data->>'manifestPath' and kind='manifest' and metadata->>'type'='working-set' and metadata->>'runId'=c.run_id::text;
  if object.path is null then raise exception 'ARCHIVE_OBJECT_NOT_STORED';end if;
  foreach t in array tables loop
   expected:=(p_data#>>array['tableCounts',t])::bigint;
   if expected is null or expected<0 or expected>(snap.tables#>>array[t,'rows'])::bigint then raise exception 'ARCHIVE_REBUILD_COUNT';end if;
   select coalesce(sum((metadata->>'rows')::bigint),0) into n from private.monitoring_archive_objects where kind='snapshot' and metadata->>'type'='working-set'
    and metadata->>'runId'=c.run_id::text and metadata->>'table'=t;
   if n<>expected then raise exception 'ARCHIVE_REBUILD_INCOMPLETE';end if;
  end loop;
  if not exists(select 1 from private.monitoring_archive_files) or not exists(select 1 from private.monitoring_archive_indices) then raise exception 'ARCHIVE_FILE_REQUIRED';end if;
  update private.monitoring_archive_snapshots s set metadata=s.metadata||jsonb_build_object('rebuild',p_data-'runId') where id=c.run_id;
  return '{"ok":true}';
 elsif p_action='rebuild_start' then
  if snap.state='rebuilding' then return jsonb_build_object('ok',true,'resumed',true);end if;
  if snap.state<>'sealed' or snap.metadata#>>'{rebuild,manifestPath}' is null then raise exception 'ARCHIVE_REBUILD_INCOMPLETE';end if;
  if exists(select 1 from pg_constraint where contype='f' and confrelid in ('public.monitoring_events'::regclass,'public.monitoring_occurrences'::regclass,'public.monitoring_results'::regclass,'public.monitoring_jobs'::regclass)
   and not conrelid=any(array['public.monitoring_events'::regclass,'public.monitoring_occurrences'::regclass,'public.monitoring_results'::regclass,'public.monitoring_jobs'::regclass])) then raise exception 'ARCHIVE_REBUILD_DEPENDENCY';end if;
  perform pg_advisory_xact_lock(791704);perform pg_advisory_xact_lock(791705);
  perform set_config('app.monitoring_archive_bypass',c.run_id::text,true);perform set_config('work_mem','64MB',true);
  foreach t in array tables loop
   execute format('select count(*) from %s',t::regclass) into n;
   if n<>(snap.tables#>>array[t,'rows'])::bigint then raise exception 'ARCHIVE_SNAPSHOT_CHANGED';end if;
  end loop;
  for item in select oc.file_id,count(*) n from public.monitoring_occurrences oc join public.monitoring_events e on e.id=oc.event_id
   where e.occurred_at<(((snap.metadata->>'cutoff')::date-1)::timestamp at time zone 'America/Sao_Paulo') group by oc.file_id loop
   update public.monitoring_files set archived_rows=archived_rows+item.n where id=item.file_id;
  end loop;
  -- NO CASCADE: only these four exported/read-model tables may be rebuilt.
  truncate table public.monitoring_occurrences,public.monitoring_events,public.monitoring_results,public.monitoring_jobs;
  update private.monitoring_archive_snapshots set state='rebuilding' where id=c.run_id;
  return jsonb_build_object('ok',true,'databaseBytes',pg_database_size(current_database()));
 elsif p_action='restore' then
  if snap.state<>'rebuilding' then raise exception 'ARCHIVE_STATE';end if;
  select * into object from private.monitoring_archive_objects where path=p_data->>'path' and kind='snapshot' and metadata->>'type'='working-set' and metadata->>'runId'=c.run_id::text;
  if object.path is null then raise exception 'ARCHIVE_OBJECT_NOT_STORED';end if;
  t:=object.metadata->>'table';if not t=any(tables) then raise exception 'ARCHIVE_TABLE_FORBIDDEN';end if;
  if exists(select 1 from private.monitoring_archive_restore_batches where run_id=c.run_id and path=object.path) then return jsonb_build_object('ok',true,'replayed',true);end if;
  raw_hash:=encode(sha256(convert_to(p_data->>'raw','UTF8')),'hex');
  if raw_hash is distinct from object.expanded_sha256 then raise exception 'ARCHIVE_RESTORE_MISMATCH';end if;
  body:=(p_data->>'raw')::jsonb;
  if body->>'table' is distinct from t or jsonb_typeof(body->'rows') is distinct from 'array' or jsonb_array_length(body->'rows')<>(object.metadata->>'rows')::int or jsonb_array_length(body->'rows')>500 then raise exception 'ARCHIVE_RESTORE_MISMATCH';end if;
  perform set_config('app.monitoring_archive_bypass',c.run_id::text,true);
  execute format('insert into %s select * from jsonb_populate_recordset(null::%s,$1) on conflict do nothing',t::regclass,t::regclass) using body->'rows';
  keys:=array(select jsonb_array_elements_text(snap.tables#>array[t,'keys']));select string_agg(format('%I',k),',') into names from unnest(keys) k;
  execute format('select count(*) from jsonb_populate_recordset(null::%s,$1) x join %s y using(%s) where to_jsonb(x)=to_jsonb(y)',t::regclass,t::regclass,names) into n using body->'rows';
  if n<>jsonb_array_length(body->'rows') then raise exception 'ARCHIVE_RESTORE_MISMATCH';end if;
  insert into private.monitoring_archive_restore_batches(run_id,table_name,path,rows) values(c.run_id,t,object.path,n);
  return jsonb_build_object('ok',true,'rows',n);
 elsif p_action='rebuild_status' then
  return jsonb_build_object('state',snap.state,'plan',snap.metadata->'rebuild','restored',(select coalesce(jsonb_object_agg(table_name,rows),'{}') from(
   select table_name,sum(rows) rows from private.monitoring_archive_restore_batches where run_id=c.run_id group by table_name) q));
 end if;
 if snap.state<>'rebuilding' then raise exception 'ARCHIVE_STATE';end if;
 foreach t in array tables loop
  expected:=(snap.metadata#>>array['rebuild','tableCounts',t])::bigint;
  execute format('select count(*) from %s',t::regclass) into n;
  if n<>expected or coalesce((select sum(rows) from private.monitoring_archive_restore_batches where run_id=c.run_id and table_name=t),0)<>expected then raise exception 'ARCHIVE_RESTORE_INCOMPLETE';end if;
 end loop;
 if pg_database_size(current_database())>=450*1024*1024 then raise exception 'ARCHIVE_DATABASE_CAPACITY';end if;
 perform set_config('app.monitoring_archive_bypass',c.run_id::text,true);
 update private.monitoring_revision set results_version=results_version+1 where id;
 update private.monitoring_archive_control set active=true,maintenance=false,updated_at=clock_timestamp() where id;
 update private.monitoring_archive_snapshots set state='active' where id=c.run_id;
 if to_regclass('cron.job') is not null then
  for item in select * from jsonb_to_recordset(coalesce(snap.metadata->'cron','[]')) as r(id bigint,active boolean) loop
   execute 'select cron.alter_job($1,active := $2)' using item.id,item.active;
  end loop;
 end if;
 return jsonb_build_object('ok',true,'active',true,'cutoff',private.monitoring_archive_cutoff(),'databaseBytes',pg_database_size(current_database()));
end $$;
revoke all on function private.monitoring_archive_worker_before_rebuild(text,jsonb),private.monitoring_archive_worker_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_archive_worker_impl(text,jsonb) to service_role;
