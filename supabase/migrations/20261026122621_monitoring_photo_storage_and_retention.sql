-- Additive rollout: deploy the photo readers before running the explicit copy/verify/commit script.
set local lock_timeout='5s';
alter table public.monitoring_photos
 add column preview_storage_path text,
 add column preview_byte_length integer,
 drop constraint monitoring_photo_preview_valid,
 add constraint monitoring_photo_preview_valid check (
  (preview_base64 is null and preview_sha256 is null and preview_thumbnail_sha256 is null and preview_storage_path is null and preview_byte_length is null)
  or (preview_sha256 is not null and preview_sha256 ~ '^[0-9a-f]{64}$'
   and preview_thumbnail_sha256 is not null and preview_thumbnail_sha256 ~ '^[0-9a-f]{64}$'
   and ((preview_base64 is not null and length(preview_base64) between 1 and 2800000 and preview_storage_path is null and preview_byte_length is null)
    or (preview_base64 is null and preview_storage_path is not null and preview_storage_path='previews/'||preview_sha256||'.jpg'
     and preview_byte_length is not null and preview_byte_length between 1 and 2000000))));

do $$begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('monitoramento-fotos','monitoramento-fotos',false,2000000,array['image/jpeg']) on conflict(id) do nothing;
  if exists(select 1 from storage.buckets where id='monitoramento-fotos' and public) then raise exception 'PHOTO_STORAGE_BUCKET_PUBLIC';end if;
 end if;
 if to_regclass('storage.objects') is not null then
  execute 'create policy monitoring_photo_server_only on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>''monitoramento-fotos'') with check(bucket_id<>''monitoramento-fotos'')';
 end if;
end $$;

create or replace function private.monitoring_photo_payload(p public.monitoring_photos,p_variant text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select case when p_variant='full' and (p).preview_thumbnail_sha256=(p).sha256 then
  case when (p).preview_storage_path is not null then
   jsonb_build_object('mimeType','image/jpeg','storagePath',(p).preview_storage_path,'sha256',(p).preview_sha256,'byteLength',(p).preview_byte_length)
  when (p).preview_base64 is not null then
   jsonb_build_object('mimeType','image/jpeg','base64',(p).preview_base64,'sha256',(p).preview_sha256)
  else jsonb_build_object('mimeType',(p).mime_type,'base64',(p).base64,'sha256',(p).sha256) end
 else jsonb_build_object('mimeType',(p).mime_type,'base64',(p).base64,'sha256',(p).sha256) end;
$$;

create function private.monitoring_photo_storage_check(p jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
declare present boolean; size integer;
begin
 if jsonb_typeof(p) is distinct from 'object' or p->>'mimeType' is distinct from 'image/jpeg'
  or coalesce(p->>'sha256','') !~ '^[0-9a-f]{64}$'
  or p->>'storagePath' is distinct from 'previews/'||(p->>'sha256')||'.jpg'
  or jsonb_typeof(p->'byteLength') is distinct from 'number'
  or coalesce(p->>'byteLength','') !~ '^[0-9]{1,7}$' then raise exception 'PHOTO_STORAGE_INVALID';end if;
 size:=(p->>'byteLength')::integer;
 if size not between 1 and 2000000 then raise exception 'PHOTO_STORAGE_INVALID';end if;
 if to_regclass('storage.objects') is null then raise exception 'PHOTO_STORAGE_UNAVAILABLE';end if;
 execute 'select exists(select 1 from storage.objects o join storage.buckets b on b.id=o.bucket_id
  where o.bucket_id=$1 and o.name=$2 and not b.public and o.metadata->>''size''=$3)'
 into present using 'monitoramento-fotos',p->>'storagePath',size::text;
 if not present then raise exception 'PHOTO_STORAGE_NOT_VERIFIED';end if;
end $$;
revoke all on function private.monitoring_photo_storage_check(jsonb) from public,anon,authenticated,service_role;

-- Older workers can still submit inline previews, atomically replacing a previous Storage reference.
do $$declare definition text;needle text:='set preview_base64=preview->>''base64'',';begin
 definition:=pg_get_functiondef('private.monitoring_ingest_impl(jsonb)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'PHOTO_STORAGE_INGEST_CHANGED';end if;
 execute replace(definition,needle,'set preview_storage_path=null,preview_byte_length=null,'||substr(needle,5));
end $$;
alter function private.monitoring_ingest_impl(jsonb) rename to monitoring_ingest_before_photo_storage;
create function private.monitoring_ingest_impl(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare payload jsonb;thumbnail jsonb;preview jsonb;answer jsonb;
begin
 if not (p_data ? 'photoWithStoredPreview') then return private.monitoring_ingest_before_photo_storage(p_data);end if;
 payload:=p_data->'photoWithStoredPreview';thumbnail:=payload->'thumbnail';preview:=payload->'preview';
 if jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(thumbnail) is distinct from 'object' then raise exception 'PHOTO_STORAGE_INVALID';end if;
 perform private.monitoring_photo_storage_check(preview);
 perform 1 from public.monitoring_photos where source_id=thumbnail->>'sourceId' and identity_value=thumbnail->>'identityValue' for update;
 answer:=private.monitoring_ingest_before_photo_previews(jsonb_build_object(
  case when payload->>'insertOnly'='true' then 'photoInsertOnly' else 'photo' end,thumbnail));
 if payload->>'insertOnly'='true' and exists(select 1 from public.monitoring_photos p
  where p.source_id=thumbnail->>'sourceId' and p.identity_value=thumbnail->>'identityValue'
   and p.preview_thumbnail_sha256=p.sha256 and p.preview_sha256 is distinct from preview->>'sha256')
  then raise exception using errcode='23505',message='PHOTO_ALREADY_EXISTS';end if;
 update public.monitoring_photos p set preview_base64=null,preview_sha256=preview->>'sha256',preview_thumbnail_sha256=p.sha256,
  preview_storage_path=preview->>'storagePath',preview_byte_length=(preview->>'byteLength')::integer
  where p.source_id=thumbnail->>'sourceId' and p.identity_value=thumbnail->>'identityValue' and p.sha256=thumbnail->>'sha256';
 if not found then raise exception 'PHOTO_PREVIEW_NOT_STORED';end if;
 return answer||jsonb_build_object('previewStored',true,'previewStorage',true);
end $$;
revoke all on function private.monitoring_ingest_before_photo_storage(jsonb),private.monitoring_ingest_impl(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_ingest_impl(jsonb) to service_role;

-- Service-only migration, bounded pages and compare-and-set. The caller must reread each object first.
create function private.monitoring_photo_storage(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.monitoring_photos; image jsonb;
begin
 if p_action='capabilities' then return '{"photoStorage":true}';
 elsif p_action='status' then return jsonb_build_object(
  'photos',(select count(*) from public.monitoring_photos),
  'pending',(select count(*) from public.monitoring_photos where preview_base64 is not null),
  'stored',(select count(*) from public.monitoring_photos where preview_storage_path is not null),
  'pendingBytes',(select coalesce(sum(octet_length(decode(preview_base64,'base64'))),0) from public.monitoring_photos),
  'thumbnailProof',(select encode(sha256(convert_to(coalesce(string_agg(jsonb_build_array(source_id,identity_value,sha256,updated_at)::text,'' order by source_id,identity_value),''),'UTF8')),'hex') from public.monitoring_photos),
  'previewProof',(select encode(sha256(convert_to(coalesce(string_agg(jsonb_build_array(source_id,identity_value,preview_sha256,preview_thumbnail_sha256)::text,'' order by source_id,identity_value),''),'UTF8')),'hex') from public.monitoring_photos),
  'databaseBytes',pg_database_size(current_database()),'photoTableBytes',pg_total_relation_size('public.monitoring_photos'),
  'storageBytes',(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects));
 elsif p_action='page' then
  return jsonb_build_object('photos',coalesce((select jsonb_agg(jsonb_build_object('sourceId',source_id,'identityValue',identity_value,
   'thumbnailSha256',sha256,'previewThumbnailSha256',preview_thumbnail_sha256,'base64',preview_base64,'sha256',preview_sha256))
   from(select * from public.monitoring_photos where preview_base64 is not null order by source_id,identity_value limit 5) q),'[]'));
 elsif p_action<>'commit' then raise exception 'PHOTO_STORAGE_ACTION_INVALID';end if;
 image:=p_data->'image';perform private.monitoring_photo_storage_check(image);
 select * into p from public.monitoring_photos where source_id=p_data->>'sourceId' and identity_value=p_data->>'identityValue' for update;
 if not found or p.sha256 is distinct from p_data->>'thumbnailSha256' or p.preview_sha256 is distinct from image->>'sha256'
  or p.preview_thumbnail_sha256 is distinct from p_data->>'previewThumbnailSha256' then raise exception 'PHOTO_STORAGE_STALE';end if;
 if p.preview_base64 is null then
  if p.preview_storage_path=image->>'storagePath' and p.preview_byte_length=(image->>'byteLength')::integer then return '{"ok":true,"replayed":true}';end if;
  raise exception 'PHOTO_STORAGE_STALE';
 end if;
 if encode(sha256(decode(p.preview_base64,'base64')),'hex') is distinct from image->>'sha256'
  or octet_length(decode(p.preview_base64,'base64')) is distinct from (image->>'byteLength')::integer then raise exception 'PHOTO_STORAGE_HASH_MISMATCH';end if;
 update public.monitoring_photos set preview_base64=null,preview_storage_path=image->>'storagePath',preview_byte_length=(image->>'byteLength')::integer
  where source_id=p.source_id and identity_value=p.identity_value;
 return '{"ok":true,"replayed":false}';
end $$;
revoke all on function private.monitoring_photo_storage(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_photo_storage(text,jsonb) to service_role;
create function public.monitoring_photo_storage(p_action text,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.monitoring_photo_storage(p_action,p_data)$$;
revoke all on function public.monitoring_photo_storage(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.monitoring_photo_storage(text,jsonb) to service_role;

-- New calculations make compaction due on the next worker round, even after retention was fully drained.
create index monitoring_results_pending_detail on public.monitoring_results(id) where not result ? 'archiveDetail';
-- Results already eligible for retirement need one verified archive, not a second detail copy.
do $$declare signature regprocedure;definition text;matched integer:=0;
 needle text:='where not result ? ''archiveDetail'' order by id limit 250';begin
 for signature in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.prokind='f' and strpos(p.prosrc,needle)>0 loop
  definition:=pg_get_functiondef(signature);
  execute replace(definition,needle,'where not result ? ''archiveDetail'' and active and (operational_date>=private.monitoring_archive_cutoff() or summary#>>''{bankDay,state}''=''ready'') order by id limit 250');
  matched:=matched+1;
 end loop;
 if matched<>1 then raise exception 'PHOTO_STORAGE_DETAILS_CHANGED';end if;
end $$;
create or replace function private.monitoring_archive_retention_due() returns boolean language sql stable security definer set search_path='' as $$
 select c.active and not c.maintenance and (r.checked_at<clock_timestamp()-interval '15 minutes'
  or (r.checked_at<clock_timestamp()-interval '1 minute' and (r.pending or exists(select 1 from public.monitoring_results where not result ? 'archiveDetail'
   and active and (operational_date>=private.monitoring_archive_cutoff() or summary#>>'{bankDay,state}'='ready')))))
 from private.monitoring_archive_control c cross join private.monitoring_archive_retention r where c.id and r.id
$$;
notify pgrst,'reload schema';
