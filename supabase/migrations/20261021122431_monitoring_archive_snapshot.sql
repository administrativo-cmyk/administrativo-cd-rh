-- Server-only archive catalog and a frozen, recoverable export. This migration
-- does not activate retention and has no data deletion operation.
create table private.monitoring_archive_control (
 id boolean primary key default true check(id), maintenance boolean not null default false,
 active boolean not null default false, months integer not null default 3 check(months=3),
 run_id uuid, updated_at timestamptz not null default clock_timestamp()
);
insert into private.monitoring_archive_control default values;
create table private.monitoring_archive_snapshots (
 id uuid primary key, state text not null check(state in ('collecting','sealed','rebuilding','active')),
 tables jsonb not null, metadata jsonb not null default '{}', manifest_path text,
 created_at timestamptz not null default clock_timestamp(), sealed_at timestamptz
);
create table private.monitoring_archive_objects (
 path text primary key check(path ~ '^[a-zA-Z0-9/_.-]+$' and path not like '%..%'),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), bytes bigint not null check(bytes between 1 and 20971520),
 expanded_sha256 text not null check(expanded_sha256 ~ '^[a-f0-9]{64}$'), expanded_bytes bigint not null check(expanded_bytes between 1 and 33554432),
 kind text not null check(kind in ('snapshot','manifest','original','archive_rows','nsr_index')),
 metadata jsonb not null default '{}', verified_at timestamptz not null default clock_timestamp()
);
create table private.monitoring_archive_exports (
 run_id uuid not null references private.monitoring_archive_snapshots,
 table_name text not null, part integer not null check(part>=0), path text not null references private.monitoring_archive_objects,
 rows integer not null check(rows>0), last_key jsonb not null,
 primary key(run_id,table_name,part), unique(path)
);
create table private.monitoring_archive_files (
 source_id text not null references public.monitoring_sources, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 parser_version text not null, manifest_path text not null references private.monitoring_archive_objects,
 rows integer not null check(rows>=0), punches integer not null check(punches>=0),
 created_at timestamptz not null default clock_timestamp(), primary key(source_id,sha256,parser_version)
);
create table private.monitoring_archive_indices (
 source_id text not null references public.monitoring_sources, shard integer not null check(shard between 0 and 99999),
 path text not null references private.monitoring_archive_objects, rows integer not null check(rows>0),
 primary key(source_id,shard,path)
);
create index monitoring_archive_index_lookup on private.monitoring_archive_indices(source_id,shard);
do $$declare t text;begin
 foreach t in array array['monitoring_archive_control','monitoring_archive_snapshots','monitoring_archive_objects','monitoring_archive_exports','monitoring_archive_files','monitoring_archive_indices'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
-- Restrictive policy also defeats a pre-existing permissive policy for all buckets.
do $$begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('monitoramento-historico','monitoramento-historico',false,20971520,array['application/gzip','application/json']) on conflict(id) do nothing;
 end if;
 if to_regclass('storage.objects') is not null then
  execute 'create policy monitoring_archive_server_only on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>''monitoramento-historico'') with check(bucket_id<>''monitoramento-historico'')';
 end if;
end $$;

create function private.monitoring_archive_cutoff() returns date language sql stable security definer set search_path='' as $$
 select ((clock_timestamp() at time zone 'America/Sao_Paulo')::date-interval '3 months')::date
$$;
revoke all on function private.monitoring_archive_cutoff() from public,anon,authenticated,service_role;

create function private.monitoring_archive_table_names() returns text[] language sql immutable set search_path='' as $$
 select array['private.monitoring_revision','public.monitoring_sources','public.monitoring_files','public.monitoring_batches',
 'public.monitoring_attempts','public.monitoring_events','public.monitoring_occurrences','public.monitoring_people','public.monitoring_bindings',
 'public.monitoring_settings','public.monitoring_photos','public.monitoring_results','public.monitoring_jobs','public.monitoring_audit',
 'private.monitoring_cloud_jobs','private.monitoring_cloud_routes','private.monitoring_group_files','private.monitoring_group_observations']::text[]
$$;
revoke all on function private.monitoring_archive_table_names() from public,anon,authenticated,service_role;

create function private.monitoring_archive_write_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare c private.monitoring_archive_control;
begin
 select * into c from private.monitoring_archive_control where id;
 if c.maintenance and current_setting('app.monitoring_archive_bypass',true) is distinct from c.run_id::text then
  raise exception using errcode='PT503',message='ARCHIVE_MAINTENANCE';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.monitoring_archive_write_guard() from public,anon,authenticated,service_role;
do $$declare t text;begin
 foreach t in array private.monitoring_archive_table_names() loop
  execute format('create trigger monitoring_archive_write_guard before insert or update or delete on %s for each row execute function private.monitoring_archive_write_guard()',t::regclass);
 end loop;
end $$;

create function private.monitoring_archive_worker_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.monitoring_archive_control; snap private.monitoring_archive_snapshots; t text; n bigint; keys text[]; k text;
 tables jsonb:='{}'; result jsonb; cursor jsonb; item jsonb; names text; comparison text; types text; q text; lim integer;
begin
 select * into c from private.monitoring_archive_control where id;
 if p_action='state' then
  return jsonb_build_object('maintenance',c.maintenance,'active',c.active,'runId',c.run_id,'months',c.months,
   'cutoff',private.monitoring_archive_cutoff(),'eventFrom',((private.monitoring_archive_cutoff()-1)::timestamp at time zone 'America/Sao_Paulo'),
   'databaseBytes',pg_database_size(current_database()),'storageBytes',(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects),
   'snapshot',(select to_jsonb(s) from private.monitoring_archive_snapshots s where s.id=c.run_id));
 elsif p_action='begin' then
  perform pg_advisory_xact_lock(791704);perform pg_advisory_xact_lock(791705);
  if c.maintenance then return jsonb_build_object('runId',c.run_id,'resumed',true);end if;
  if exists(select 1 from private.monitoring_cloud_jobs where status='processing' and lease_expires_at>clock_timestamp())
   or exists(select 1 from public.monitoring_jobs where leased_until>clock_timestamp()) then raise exception 'ARCHIVE_WORKER_BUSY';end if;
  c.run_id:=gen_random_uuid();
  update private.monitoring_archive_control set maintenance=true,run_id=c.run_id,updated_at=clock_timestamp() where id;
  foreach t in array private.monitoring_archive_table_names() loop
   execute format('select count(*) from %s',t::regclass) into n;
   select array_agg(a.attname order by u.ord) into keys from pg_index i cross join lateral unnest(i.indkey) with ordinality u(attnum,ord)
    join pg_attribute a on a.attrelid=i.indrelid and a.attnum=u.attnum where i.indrelid=t::regclass and i.indisprimary;
   if keys is null then raise exception 'ARCHIVE_TABLE_WITHOUT_KEY';end if;
   tables:=tables||jsonb_build_object(t,jsonb_build_object('rows',n,'keys',keys));
  end loop;
  if to_regclass('cron.job') is not null then
   execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'',jobid,''active'',active)),''[]''::jsonb) from cron.job where jobname=''monitoring-cloud-dispatch''' into result;
   execute 'update cron.job set active=false where jobname=''monitoring-cloud-dispatch''';
  else result:='[]';end if;
  insert into private.monitoring_archive_snapshots(id,state,tables,metadata) values(c.run_id,'collecting',tables,jsonb_build_object('cron',result,'cutoff',private.monitoring_archive_cutoff()));
  return jsonb_build_object('runId',c.run_id,'tables',tables);
 elsif p_action='catalog' then
  if coalesce(p_data->>'prefix','')!~'^[a-zA-Z0-9/_.-]*$' or coalesce(p_data->>'prefix','') like '%..%' then raise exception 'ARCHIVE_INVALID';end if;
  return jsonb_build_object('objects',(select coalesce(jsonb_agg(to_jsonb(o) order by path),'[]') from private.monitoring_archive_objects o where path like coalesce(p_data->>'prefix','')||'%'));
 elsif p_action='objects' then
  if jsonb_typeof(p_data->'objects') is distinct from 'array' or jsonb_array_length(p_data->'objects')>500 then raise exception 'ARCHIVE_INVALID';end if;
  for item in select value from jsonb_array_elements(p_data->'objects') loop
   if coalesce(item->>'path','')!~'^[a-zA-Z0-9/_.-]+$' or item->>'path' like '%..%' or item->>'path' like '/%'
    or not exists(select 1 from storage.objects o where o.bucket_id='monitoramento-historico' and o.name=item->>'path' and (o.metadata->>'size')::bigint=(item->>'bytes')::bigint)
    then raise exception 'ARCHIVE_OBJECT_NOT_STORED';end if;
   insert into private.monitoring_archive_objects(path,sha256,bytes,expanded_sha256,expanded_bytes,kind,metadata)
   values(item->>'path',item->>'sha256',(item->>'bytes')::bigint,item->>'expandedSha256',(item->>'expandedBytes')::bigint,item->>'kind',coalesce(item->'metadata','{}')) on conflict(path) do nothing;
   if not exists(select 1 from private.monitoring_archive_objects where path=item->>'path' and sha256=item->>'sha256' and bytes=(item->>'bytes')::bigint
    and expanded_sha256=item->>'expandedSha256' and expanded_bytes=(item->>'expandedBytes')::bigint and kind=item->>'kind' and metadata=coalesce(item->'metadata','{}')) then raise exception 'ARCHIVE_OBJECT_IMMUTABLE';end if;
  end loop;
  return jsonb_build_object('ok',true,'registered',jsonb_array_length(p_data->'objects'));
 end if;
 if not c.maintenance or c.run_id is distinct from (p_data->>'runId')::uuid then raise exception 'ARCHIVE_RUN_REQUIRED';end if;
 select * into strict snap from private.monitoring_archive_snapshots where id=c.run_id;
 if p_action='restore_queue' then
  if snap.state<>'collecting' or (snap.tables#>>'{public.monitoring_jobs,rows}')::bigint<>0
   or jsonb_typeof(p_data->'rows') is distinct from 'array' or jsonb_array_length(p_data->'rows')>500 then raise exception 'ARCHIVE_STATE';end if;
  perform set_config('app.monitoring_archive_bypass',c.run_id::text,true);
  insert into public.monitoring_jobs select * from jsonb_populate_recordset(null::public.monitoring_jobs,p_data->'rows') on conflict(employee_id,operational_date) do nothing;
  for item in select value from jsonb_array_elements(p_data->'rows') loop
   if not exists(select 1 from public.monitoring_jobs j where employee_id=(item->>'employee_id')::uuid and operational_date=(item->>'operational_date')::date and to_jsonb(j)=item) then raise exception 'ARCHIVE_RESTORE_MISMATCH';end if;
  end loop;
  return jsonb_build_object('ok',true,'rows',jsonb_array_length(p_data->'rows'));
 elsif p_action='adopt_queue' then
  if snap.state<>'collecting' or (snap.tables#>>'{public.monitoring_jobs,rows}')::bigint<>0 or coalesce(p_data->>'sha256','')!~'^[a-f0-9]{64}$' then raise exception 'ARCHIVE_STATE';end if;
  perform set_config('work_mem','32MB',true);
  select count(*),to_jsonb(encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(j) order by employee_id,operational_date),'[]')::text,'UTF8')),'hex')) into n,result from public.monitoring_jobs j;
  if n<>(p_data->>'rows')::bigint or result#>>'{}'<>p_data->>'sha256' then raise exception 'ARCHIVE_RESTORE_MISMATCH';end if;
  update private.monitoring_archive_snapshots s set tables=jsonb_set(s.tables,'{public.monitoring_jobs,rows}',to_jsonb(n)),metadata=s.metadata||jsonb_build_object('emergencyQueue',p_data-'runId') where s.id=c.run_id;
  return jsonb_build_object('ok',true,'rows',n,'sha256',result);
 elsif p_action='page' then
  t:=p_data->>'table';if not t=any(private.monitoring_archive_table_names()) then raise exception 'ARCHIVE_TABLE_FORBIDDEN';end if;
  keys:=array(select jsonb_array_elements_text(snap.tables#>array[t,'keys']));
  names:='';comparison:='';
  foreach k in array keys loop
   select format_type(atttypid,atttypmod) into types from pg_attribute where attrelid=t::regclass and attname=k;
   names:=names||case when names='' then '' else ',' end||format('t.%I',k);
   comparison:=comparison||case when comparison='' then '' else ',' end||format('($1->>%L)::%s',k,types);
   if p_data->'after' is not null and not(p_data->'after' ? k) then raise exception 'ARCHIVE_CURSOR_INVALID';end if;
  end loop;
  lim:=least(case when t='public.monitoring_photos' then 1 else 500 end,greatest(1,coalesce((p_data->>'limit')::integer,200)));
  q:=format('select coalesce(jsonb_agg(to_jsonb(q)),''[]''::jsonb) from (select t.* from %s t %s order by %s limit %s) q',t::regclass,
   case when p_data->'after' is null then '' else format('where (%s)>(%s)',names,comparison) end,names,lim);
  execute q into result using p_data->'after';
  cursor:='{}';if jsonb_array_length(result)>0 then
   foreach k in array keys loop cursor:=cursor||jsonb_build_object(k,result->(jsonb_array_length(result)-1)->k);end loop;
  end if;
  return jsonb_build_object('rows',result,'next',case when jsonb_array_length(result)=0 then null else cursor end,'expectedRows',snap.tables#>array[t,'rows']);
 elsif p_action='exported' then
  t:=p_data->>'table';if not t=any(private.monitoring_archive_table_names()) then raise exception 'ARCHIVE_TABLE_FORBIDDEN';end if;
  if snap.state<>'collecting' then raise exception 'ARCHIVE_STATE';end if;
  if not exists(select 1 from private.monitoring_archive_objects where path=p_data->>'path' and kind='snapshot' and path like 'snapshots/'||c.run_id::text||'/%') then raise exception 'ARCHIVE_OBJECT_NOT_STORED';end if;
  insert into private.monitoring_archive_exports(run_id,table_name,part,path,rows,last_key)
   values(c.run_id,t,(p_data->>'part')::integer,p_data->>'path',(p_data->>'rows')::integer,p_data->'lastKey') on conflict do nothing;
  if not exists(select 1 from private.monitoring_archive_exports where run_id=c.run_id and table_name=t and part=(p_data->>'part')::integer
   and path=p_data->>'path' and rows=(p_data->>'rows')::integer and last_key=p_data->'lastKey') then raise exception 'ARCHIVE_EXPORT_IMMUTABLE';end if;
  return '{"ok":true}';
 elsif p_action='export_status' then
  return jsonb_build_object('parts',(select coalesce(jsonb_agg(to_jsonb(e) order by table_name,part),'[]') from private.monitoring_archive_exports e where run_id=c.run_id));
 elsif p_action='seal' then
  foreach t in array private.monitoring_archive_table_names() loop
   if coalesce((select sum(rows) from private.monitoring_archive_exports where run_id=c.run_id and table_name=t),0)<>(snap.tables#>>array[t,'rows'])::bigint then raise exception 'ARCHIVE_EXPORT_INCOMPLETE';end if;
   execute format('select count(*) from %s',t::regclass) into n;
   if n<>(snap.tables#>>array[t,'rows'])::bigint then raise exception 'ARCHIVE_SNAPSHOT_CHANGED';end if;
  end loop;
  if not exists(select 1 from private.monitoring_archive_objects where path=p_data->>'manifestPath' and kind='manifest' and path like 'snapshots/'||c.run_id::text||'/%') then raise exception 'ARCHIVE_OBJECT_NOT_STORED';end if;
  update private.monitoring_archive_snapshots set state='sealed',manifest_path=p_data->>'manifestPath',sealed_at=clock_timestamp() where id=c.run_id and state in ('collecting','sealed');
  return '{"ok":true}';
 end if;
 raise exception 'ARCHIVE_UNKNOWN_ACTION';
end $$;
revoke all on function private.monitoring_archive_worker_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_archive_worker_impl(text,jsonb) to service_role;
create function public.monitoring_archive_worker(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.monitoring_archive_worker_impl(p_action,p_data)$$;
revoke all on function public.monitoring_archive_worker(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.monitoring_archive_worker(text,jsonb) to service_role;
