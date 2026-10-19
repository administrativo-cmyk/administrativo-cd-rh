-- Private originals and durable cloud imports. Scheduling is activated separately.
create table private.monitoring_cloud_jobs (
 id uuid primary key default gen_random_uuid(), source_id text not null references public.monitoring_sources,
 source jsonb not null, source_contract jsonb not null, file_name text not null,
 object_path text not null unique, byte_length bigint not null check(byte_length between 1 and 20971520),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'), parser_version text not null,
 status text not null default 'uploading' check(status in ('uploading','queued','processing','completed','failed','cancelled')),
 cursor integer not null default 0 check(cursor>=0), processed_rows integer not null default 0 check(processed_rows>=0),
 total_rows integer, total_batches integer, plan jsonb,
 attempts integer not null default 0 check(attempts between 0 and 5), retry_pending boolean not null default true,
 next_retry_at timestamptz, lease_token uuid, lease_version bigint not null default 0, lease_expires_at timestamptz,
 last_batch_hash text, last_batch_result jsonb, last_error text,
 created_by uuid not null references public.perfis, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 check(total_rows is null or total_rows>=0), check(total_batches is null or total_batches>0),
 check((status='processing')=(lease_token is not null and lease_expires_at is not null))
);
create unique index monitoring_cloud_jobs_live_identity on private.monitoring_cloud_jobs(source_id,sha256,parser_version)
 where status in ('uploading','queued','processing','completed');
create index monitoring_cloud_jobs_due on private.monitoring_cloud_jobs(status,next_retry_at,created_at);
create table private.monitoring_cloud_dispatches (
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null, consumed_at timestamptz
);
alter table private.monitoring_cloud_jobs enable row level security;
alter table private.monitoring_cloud_dispatches enable row level security;
revoke all on private.monitoring_cloud_jobs,private.monitoring_cloud_dispatches from public,anon,authenticated,service_role;

-- Storage is absent in the portable PostgreSQL harness. Hosted Supabase has both tables.
do $$begin
 if to_regclass('storage.buckets') is not null then
  execute $storage$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('monitoramento-originais','monitoramento-originais',false,20971520,
    array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','application/octet-stream'])
   on conflict(id) do update set public=false,file_size_limit=20971520,allowed_mime_types=excluded.allowed_mime_types$storage$;
 end if;
 if to_regclass('storage.objects') is not null then
  execute $storage$create policy monitoring_cloud_private_originals on storage.objects as restrictive for all to anon,authenticated
   using(bucket_id<>'monitoramento-originais') with check(bucket_id<>'monitoramento-originais')$storage$;
 end if;
end $$;
-- No browser table/storage policies are granted. The server issues path-scoped upload tokens.

create function private.monitoring_cloud_source(p_source public.monitoring_sources) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object('id',p_source.id,'kind',p_source.kind,'timeZone',p_source.timezone,
  'identityNamespace',p_source.identity_namespace,'sourceIdentityConfirmed',coalesce((p_source.configuration->>'sourceIdentityConfirmed')::boolean,false),
  'declaredCoverage',p_source.configuration->'declaredCoverage'))
$$;
revoke all on function private.monitoring_cloud_source(public.monitoring_sources) from public,anon,authenticated,service_role;

create function private.monitoring_cloud_json(p_job private.monitoring_cloud_jobs,p_lease boolean default false) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',p_job.id,'sourceId',p_job.source_id,'source',p_job.source,'fileName',p_job.file_name,
  'bucket','monitoramento-originais','objectPath',p_job.object_path,'byteLength',p_job.byte_length,'sha256',p_job.sha256,
  'parserVersion',p_job.parser_version,'status',p_job.status,'cursor',p_job.cursor,'processedRows',p_job.processed_rows,
  'totalRows',p_job.total_rows,'totalBatches',p_job.total_batches,'plan',p_job.plan,'attempts',p_job.attempts,'maxAttempts',5,
  'nextRetryAt',p_job.next_retry_at,'lastError',p_job.last_error,'createdAt',p_job.created_at,'updatedAt',p_job.updated_at,
  'completedAt',p_job.completed_at)||case when p_lease and p_job.lease_token is not null then jsonb_build_object('leaseToken',p_job.lease_token,
  'leaseVersion',p_job.lease_version,'leaseExpiresAt',p_job.lease_expires_at) else '{}'::jsonb end
$$;
revoke all on function private.monitoring_cloud_json(private.monitoring_cloud_jobs,boolean) from public,anon,authenticated,service_role;

create function private.monitoring_cloud_reserved_bytes() returns bigint language plpgsql security definer set search_path='' as $$
declare bytes bigint;
begin
 if to_regclass('storage.objects') is not null then
  execute $quota$select coalesce(sum(greatest(j.byte_length,case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end)),0)
   from private.monitoring_cloud_jobs j left join storage.objects o on o.bucket_id='monitoramento-originais' and o.name=j.object_path
   where o.id is not null or j.status in ('uploading','queued','processing')
    or (j.status in ('cancelled','failed') and j.updated_at>clock_timestamp()-interval '3 hours')$quota$ into bytes;
 else
  select coalesce(sum(byte_length),0) into bytes from private.monitoring_cloud_jobs where status<>'cancelled' or updated_at>clock_timestamp()-interval '3 hours';
 end if;
 return bytes;
end $$;
revoke all on function private.monitoring_cloud_reserved_bytes() from public,anon,authenticated,service_role;

create function private.monitoring_cloud_automation_ready() returns boolean language plpgsql stable security definer set search_path='' as $$
declare ready boolean:=false;
begin
 if to_regclass('cron.job') is null or to_regprocedure('private.monitoring_cloud_dispatch_tick()') is null then return false; end if;
 execute $cron$select exists(select 1 from cron.job where jobname='monitoring-cloud-dispatch' and active
  and schedule='* * * * *' and btrim(command)='select private.monitoring_cloud_dispatch_tick()')$cron$ into ready;
 return ready;
exception when insufficient_privilege or undefined_table then return false;
end $$;
revoke all on function private.monitoring_cloud_automation_ready() from public,anon,authenticated,service_role;

create function private.monitoring_cloud_admin_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); job private.monitoring_cloud_jobs; source public.monitoring_sources;
 contract jsonb; source_config jsonb; file_name text; bytes bigint; hash text; parser text; object_bytes bigint;
 v_offset integer:=greatest(coalesce((p_data->>'offset')::integer,0),0); v_limit integer:=least(greatest(coalesce((p_data->>'limit')::integer,50),1),100);
begin
 perform 1 from public.perfis where id=actor and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH') for share;
 if not found then raise exception using errcode='42501',message='CLOUD_FORBIDDEN'; end if;
 if p_action='list' then
  return jsonb_build_object('jobs',(select coalesce(jsonb_agg(private.monitoring_cloud_json(j) order by j.created_at desc,j.id),'[]') from
   (select * from private.monitoring_cloud_jobs order by created_at desc,id offset v_offset limit v_limit) j),
   'total',(select count(*) from private.monitoring_cloud_jobs),'offset',v_offset,'limit',v_limit,'maxFileBytes',20971520,
   'automationReady',private.monitoring_cloud_automation_ready(),
   'sources',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',coalesce(s.label,s.id),'kind',s.kind) order by coalesce(s.label,s.id)),'[]') from public.monitoring_sources s where s.active));
 elsif p_action='create' then
  -- Same lock order as source management and ingest; a source cannot change mid-operation.
  perform pg_advisory_xact_lock(791704);
  select * into source from public.monitoring_sources where id=p_data->>'sourceId';
  if source.id is null or not source.active then raise exception using errcode='PT409',message='CLOUD_SOURCE_UNAVAILABLE'; end if;
  file_name:=btrim(p_data->>'fileName'); bytes:=(p_data->>'byteLength')::bigint; hash:=p_data->>'sha256'; parser:=p_data->>'parserVersion';
  if bytes is null or bytes not between 1 and 20971520 or coalesce(hash,'')!~'^[a-f0-9]{64}$'
   or coalesce(length(file_name),0) not between 1 and 200 or file_name ~ '[[:cntrl:]/\\]' or file_name in ('.','..')
   or coalesce(length(parser),0) not between 1 and 100
   or (source.kind='afd' and (coalesce(p_data->>'afdProfile','') not in ('legacy','iso') or lower(file_name) not like '%.txt'))
   or (source.kind<>'afd' and (p_data ? 'afdProfile' or lower(file_name) not like '%.xlsx'))
   or coalesce(p_data->>'encoding','utf8') not in ('utf8','latin1') then raise exception using errcode='PT400',message='CLOUD_INVALID_FILE'; end if;
  contract:=private.monitoring_cloud_source(source);
  source_config:=contract||case when source.kind='afd' then jsonb_build_object('afdProfile',p_data->>'afdProfile','encoding',coalesce(p_data->>'encoding','utf8')) else '{}'::jsonb end;
  select * into job from private.monitoring_cloud_jobs where source_id=source.id and sha256=hash and parser_version=parser and status in ('uploading','queued','processing','completed');
  if found then
   if job.byte_length<>bytes or job.source is distinct from source_config then raise exception using errcode='PT409',message='CLOUD_DUPLICATE_DIFFERENT_SOURCE'; end if;
   if to_regclass('storage.objects') is not null then
    execute 'select (metadata->>''size'')::bigint from storage.objects where bucket_id=$1 and name=$2'
     into object_bytes using 'monitoramento-originais',job.object_path;
   end if;
   return jsonb_build_object('job',private.monitoring_cloud_json(job),'duplicate',true,'uploadPresent',object_bytes is not distinct from job.byte_length);
  end if;
  if (select count(*) from private.monitoring_cloud_jobs where created_by=actor and status in ('uploading','queued','processing'))>=10
   or (select count(*) from private.monitoring_cloud_jobs where status in ('uploading','queued','processing'))>=100
   or private.monitoring_cloud_reserved_bytes()+bytes>524288000 then
   raise exception using errcode='PT409',message='CLOUD_QUOTA'; end if;
  job.id:=gen_random_uuid();
  insert into private.monitoring_cloud_jobs(id,source_id,source,source_contract,file_name,object_path,byte_length,sha256,parser_version,created_by)
   values(job.id,source.id,source_config,contract,file_name,job.id::text||'/original',bytes,hash,parser,actor) returning * into job;
  insert into public.monitoring_audit(actor,action,target,detail) values(actor,'cloud_upload_created',job.id::text,jsonb_build_object('sourceId',source.id,'sha256',hash,'byteLength',bytes));
  return jsonb_build_object('job',private.monitoring_cloud_json(job),'duplicate',false,'uploadPresent',false);
 end if;
 if p_action not in ('get','complete','retry','cancel') or p_action is null then raise exception using errcode='PT400',message='CLOUD_UNKNOWN_ACTION'; end if;
 if p_action<>'get' then perform pg_advisory_xact_lock(791704); end if;
 select * into job from private.monitoring_cloud_jobs where id=(p_data->>'id')::uuid for update;
 if not found then raise exception using errcode='PT404',message='CLOUD_NOT_FOUND'; end if;
 if p_action='get' then return jsonb_build_object('job',private.monitoring_cloud_json(job)); end if;
 if p_action='complete' and job.status in ('queued','processing','completed','failed') then return jsonb_build_object('job',private.monitoring_cloud_json(job)); end if;
 if nullif(p_data->>'expectedUpdatedAt','')::timestamptz is distinct from job.updated_at then raise exception using errcode='PT409',message='CLOUD_STALE'; end if;
 if p_action in ('complete','retry') then
  select * into source from public.monitoring_sources where id=job.source_id;
  if not source.active or private.monitoring_cloud_source(source) is distinct from job.source_contract then raise exception using errcode='PT409',message='CLOUD_SOURCE_CHANGED'; end if;
 end if;
 if p_action='complete' then
  if job.status<>'uploading' then raise exception using errcode='PT409',message='CLOUD_INVALID_STATE'; end if;
  if to_regclass('storage.objects') is null then raise exception using errcode='PT503',message='CLOUD_STORAGE_UNAVAILABLE'; end if;
  execute 'select (metadata->>''size'')::bigint from storage.objects where bucket_id=$1 and name=$2'
   into object_bytes using 'monitoramento-originais',job.object_path;
  if object_bytes is null then raise exception using errcode='PT409',message='CLOUD_UPLOAD_MISSING'; end if;
  if object_bytes<>job.byte_length then raise exception using errcode='PT409',message='CLOUD_UPLOAD_INVALID'; end if;
  -- Size is independently checked against Storage. Runner checks the actual SHA-256 before ingest.
  update private.monitoring_cloud_jobs set status='queued',next_retry_at=clock_timestamp(),updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=job.id returning * into job;
 elsif p_action='retry' then
  if job.status<>'failed' or job.attempts>=5 then raise exception using errcode='PT409',message='CLOUD_RETRY_UNAVAILABLE'; end if;
  if exists(select 1 from private.monitoring_cloud_jobs where source_id=job.source_id and sha256=job.sha256 and parser_version=job.parser_version
   and id<>job.id and status in ('uploading','queued','processing','completed')) then raise exception using errcode='PT409',message='CLOUD_RETRY_UNAVAILABLE'; end if;
  update private.monitoring_cloud_jobs set status='queued',retry_pending=true,next_retry_at=clock_timestamp(),last_error=null,
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=job.id returning * into job;
 else
  if job.status not in ('uploading','queued','processing','failed') then raise exception using errcode='PT409',message='CLOUD_INVALID_STATE'; end if;
  update private.monitoring_cloud_jobs set status='cancelled',lease_token=null,lease_expires_at=null,lease_version=lease_version+1,next_retry_at=null,
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=job.id returning * into job;
 end if;
 insert into public.monitoring_audit(actor,action,target,detail) values(actor,'cloud_'||p_action,job.id::text,jsonb_build_object('status',job.status,'cursor',job.cursor));
 return jsonb_build_object('job',private.monitoring_cloud_json(job));
end $$;
revoke all on function private.monitoring_cloud_admin_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_cloud_admin_impl(text,jsonb) to authenticated;
create function public.monitoring_cloud_admin(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.monitoring_cloud_admin_impl(p_action,p_data)$$;
revoke all on function public.monitoring_cloud_admin(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.monitoring_cloud_admin(text,jsonb) to authenticated;

create function private.monitoring_cloud_reprocess_due() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.monitoring_jobs j where j.operational_date<=(now() at time zone 'America/Sao_Paulo')::date
  and (j.leased_until is null or j.leased_until<=now()) and exists(select 1 from public.monitoring_bindings b
   join public.monitoring_sources bs on bs.id=b.source_id join public.monitoring_sources s on s.identity_namespace=bs.identity_namespace
   -- Revocation and disabling also enqueue invalidations. Match the existing worker claim,
   -- including former bindings, so removal of the last evidence cannot strand stale results.
   where b.employee_id=j.employee_id))
$$;
revoke all on function private.monitoring_cloud_reprocess_due() from public,anon,authenticated,service_role;

-- Only the database scheduler may issue dispatch tokens. Raw tokens are never persisted here.
create function private.monitoring_cloud_issue_dispatch() returns text language plpgsql security definer set search_path='' as $$
declare token text;
begin
 perform pg_advisory_xact_lock(791705);
 delete from private.monitoring_cloud_dispatches where expires_at<clock_timestamp()-interval '1 day';
 update private.monitoring_cloud_jobs set status='failed',last_error='CLOUD_ATTEMPTS_EXHAUSTED',lease_token=null,lease_expires_at=null,next_retry_at=null,
  updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where status='processing' and lease_expires_at<=clock_timestamp() and attempts>=5;
 if exists(select 1 from private.monitoring_cloud_dispatches where consumed_at is null and expires_at>clock_timestamp())
  or exists(select 1 from private.monitoring_cloud_jobs where status='processing' and lease_expires_at>clock_timestamp()) then return null; end if;
 if not exists(select 1 from private.monitoring_cloud_jobs where (status='queued' and coalesce(next_retry_at,'-infinity')<=clock_timestamp())
  or (status='processing' and lease_expires_at<=clock_timestamp() and attempts<5)) and not private.monitoring_cloud_reprocess_due() then return null; end if;
 -- Three independent UUIDv4 values provide >256 bits of random input; SHA-256 encodes a 256-bit capability.
 token:=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
 insert into private.monitoring_cloud_dispatches(token_hash,expires_at) values(encode(sha256(convert_to(token,'UTF8')),'hex'),clock_timestamp()+interval '60 seconds');
 return token;
end $$;
revoke all on function private.monitoring_cloud_issue_dispatch() from public,anon,authenticated,service_role;

create function private.monitoring_cloud_worker_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.monitoring_cloud_jobs; source public.monitoring_sources; batch jsonb:=p_data->'batch'; output jsonb;
 expected integer; batch_hash text; rows integer; batches integer; code text;
begin
 if p_action='claim' then
  perform pg_advisory_xact_lock(791705);
  update private.monitoring_cloud_dispatches set consumed_at=clock_timestamp() where token_hash=p_data->>'tokenHash' and consumed_at is null and expires_at>clock_timestamp();
  if not found then raise exception using errcode='PT401',message='CLOUD_DISPATCH_INVALID'; end if;
  if exists(select 1 from private.monitoring_cloud_jobs where status='processing' and lease_expires_at>clock_timestamp()) then return jsonb_build_object('job',null,'reprocess',false); end if;
  select * into job from private.monitoring_cloud_jobs where (status='queued' and coalesce(next_retry_at,'-infinity')<=clock_timestamp() and attempts<5)
   or (status='queued' and not retry_pending and coalesce(next_retry_at,'-infinity')<=clock_timestamp())
   or (status='processing' and lease_expires_at<=clock_timestamp() and attempts<5)
   order by created_at,id for update skip locked limit 1;
  if not found then return jsonb_build_object('job',null,'reprocess',private.monitoring_cloud_reprocess_due()); end if;
  select * into source from public.monitoring_sources where id=job.source_id;
  if not source.active or private.monitoring_cloud_source(source) is distinct from job.source_contract then
   update private.monitoring_cloud_jobs set status='failed',last_error='CLOUD_SOURCE_CHANGED',lease_token=null,lease_expires_at=null,next_retry_at=null,
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=job.id;
   return jsonb_build_object('job',null,'reprocess',private.monitoring_cloud_reprocess_due());
  end if;
  update private.monitoring_cloud_jobs set attempts=attempts+case when retry_pending or status='processing' then 1 else 0 end,
   status='processing',retry_pending=false,lease_token=gen_random_uuid(),lease_version=lease_version+1,lease_expires_at=clock_timestamp()+interval '300 seconds',next_retry_at=null,
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=job.id returning * into job;
  return jsonb_build_object('job',private.monitoring_cloud_json(job,true),'reprocess',true);
 end if;
 if p_action is null or p_action not in ('persist','extend','release','fail','finish') then raise exception using errcode='PT400',message='CLOUD_UNKNOWN_ACTION'; end if;
 -- Acquire the ingest/source lock before the row lock to avoid a source-edit/ingest deadlock.
 perform pg_advisory_xact_lock(791704);
 select * into job from private.monitoring_cloud_jobs where id=(p_data->>'id')::uuid for update;
 if not found or job.status<>'processing' or job.lease_token is distinct from (p_data->>'leaseToken')::uuid or job.lease_expires_at<=clock_timestamp() then
  raise exception using errcode='PT409',message='CLOUD_LEASE_LOST'; end if;
 if p_action in ('persist','extend','finish') then
  select * into source from public.monitoring_sources where id=job.source_id;
  if not source.active or private.monitoring_cloud_source(source) is distinct from job.source_contract then raise exception using errcode='PT409',message='CLOUD_SOURCE_CHANGED'; end if;
 end if;
 if p_action='persist' then
  expected:=(p_data->>'expectedCursor')::integer;
  batch_hash:=encode(sha256(convert_to(batch::text,'UTF8')),'hex');
  if job.plan is not null and job.plan is distinct from p_data->'plan' then raise exception using errcode='PT409',message='CLOUD_PLAN_CHANGED'; end if;
  if expected=job.cursor-1 and batch_hash=job.last_batch_hash then return jsonb_build_object('job',private.monitoring_cloud_json(job,true),'result',job.last_batch_result,'replayed',true); end if;
  if expected is distinct from job.cursor or (batch#>>'{batch,index}')::integer is distinct from job.cursor then raise exception using errcode='PT409',message='CLOUD_CURSOR_STALE'; end if;
  rows:=(batch#>>'{batch,occurrenceCount}')::integer; batches:=(batch#>>'{batch,totalBatches}')::integer;
  if batch is null or batch->'heartbeat' is not null or batch->'failure' is not null or batch->'photo' is not null
   or batch#>>'{file,sha256}' is distinct from job.sha256 or (batch#>>'{file,byteLength}')::bigint is distinct from job.byte_length
   or batch#>>'{file,parserVersion}' is distinct from job.parser_version or batch#>>'{file,relativePath}' is distinct from job.file_name
   or batch#>>'{source,id}' is distinct from job.source_id or batch#>>'{source,kind}' is distinct from job.source->>'kind'
   or batch#>>'{source,timeZone}' is distinct from job.source->>'timeZone' or coalesce(batch#>>'{source,identityNamespace}',job.source_id) is distinct from job.source->>'identityNamespace'
   or coalesce((batch#>>'{source,sourceIdentityConfirmed}')::boolean,false) is distinct from (job.source->>'sourceIdentityConfirmed')::boolean
   or nullif(batch#>'{source,declaredCoverage}','null') is distinct from nullif(job.source->'declaredCoverage','null')
   or rows is null or rows<0 or batches is null or batches<1 or batches>500000 or job.cursor>=batches
   or jsonb_typeof(batch->'occurrences') is distinct from 'array' or jsonb_array_length(batch->'occurrences')>500
   or (batch#>>'{batch,final}')::boolean is distinct from (job.cursor=batches-1)
   or (job.total_rows is not null and (rows<>job.total_rows or batches<>job.total_batches))
   or job.processed_rows+jsonb_array_length(batch->'occurrences')>rows then raise exception using errcode='PT400',message='CLOUD_BATCH_INVALID'; end if;
  if p_data->'plan' is null or jsonb_typeof(p_data->'plan')<>'object' or coalesce(p_data#>>'{plan,layoutHash}','')!~'^[a-f0-9]{64}$'
   or (p_data#>>'{plan,version}')::integer is distinct from 1 or p_data#>>'{plan,parserVersion}' is distinct from job.parser_version
   or (p_data#>>'{plan,batchSize}')::integer is distinct from 500 or (p_data#>>'{plan,bodyLimitBytes}')::integer is distinct from 4400000
   or (p_data#>>'{plan,totalBatches}')::integer is distinct from batches or (p_data#>>'{plan,occurrenceCount}')::integer is distinct from rows
   or (job.plan is not null and job.plan is distinct from p_data->'plan') then raise exception using errcode='PT409',message='CLOUD_PLAN_CHANGED'; end if;
  -- The fence remains locked through ingestion and checkpoint. Failed ingestion advances nothing.
  output:=public.monitoring_ingest(batch);
  update private.monitoring_cloud_jobs set cursor=cursor+1,processed_rows=processed_rows+jsonb_array_length(batch->'occurrences'),total_rows=rows,total_batches=batches,
   plan=coalesce(plan,p_data->'plan'),last_batch_hash=batch_hash,last_batch_result=output,last_error=null,lease_expires_at=clock_timestamp()+interval '300 seconds',
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=job.id returning * into job;
 elsif p_action='extend' then
  update private.monitoring_cloud_jobs set lease_expires_at=clock_timestamp()+interval '300 seconds',updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=job.id returning * into job;
 elsif p_action='release' then
  update private.monitoring_cloud_jobs set status='queued',retry_pending=false,lease_token=null,lease_expires_at=null,next_retry_at=clock_timestamp(),
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=job.id returning * into job;
 elsif p_action='fail' then
  code:=p_data->>'code';
  if coalesce(code,'')!~'^[A-Z][A-Z0-9_]{2,99}$' then code:='CLOUD_PROCESSING_FAILED'; end if;
  update private.monitoring_cloud_jobs set status=case when p_data->>'retryable'='true' and attempts<5 then 'queued' else 'failed' end,
   retry_pending=true,lease_token=null,lease_expires_at=null,last_error=code,
   next_retry_at=case when p_data->>'retryable'='true' and attempts<5 then clock_timestamp()+make_interval(secs=>least(3600,60*power(2,attempts-1)::integer)) else null end,
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=job.id returning * into job;
 else
  if job.total_batches is null or job.cursor<>job.total_batches or job.processed_rows<>job.total_rows
   or not exists(select 1 from public.monitoring_files f where f.source_id=job.source_id and f.sha256=job.sha256 and f.parser_version=job.parser_version and f.status in ('complete','conflict') and f.completed_at is not null) then
   raise exception using errcode='PT409',message='CLOUD_NOT_FINISHED'; end if;
  update private.monitoring_cloud_jobs set status='completed',lease_token=null,lease_expires_at=null,next_retry_at=null,completed_at=clock_timestamp(),last_error=null,
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=job.id returning * into job;
 end if;
 return jsonb_build_object('job',private.monitoring_cloud_json(job,true),'result',output);
end $$;
revoke all on function private.monitoring_cloud_worker_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_cloud_worker_impl(text,jsonb) to service_role;
create function public.monitoring_cloud_worker(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.monitoring_cloud_worker_impl(p_action,p_data)$$;
revoke all on function public.monitoring_cloud_worker(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.monitoring_cloud_worker(text,jsonb) to service_role;
