-- Full-photo reads may reference the exact imported JPEG, PNG or WebP.
-- Existing previews and authorization stay compatible during deployment.
set local lock_timeout='5s';
alter table public.monitoring_photos
 add column preview_mime_type text not null default 'image/jpeg'
  check(preview_mime_type in ('image/jpeg','image/png','image/webp')),
 drop constraint monitoring_photo_preview_valid,
 add constraint monitoring_photo_preview_valid check (
  (preview_base64 is null and preview_sha256 is null and preview_thumbnail_sha256 is null and preview_storage_path is null and preview_byte_length is null)
  or (preview_sha256 is not null and preview_sha256 ~ '^[0-9a-f]{64}$'
   and preview_thumbnail_sha256 is not null and preview_thumbnail_sha256 ~ '^[0-9a-f]{64}$'
   and ((preview_base64 is not null and length(preview_base64) between 1 and 2800000
     and preview_storage_path is null and preview_byte_length is null and preview_mime_type='image/jpeg')
    or (preview_base64 is null and preview_storage_path is not null
     and ((preview_mime_type='image/jpeg' and preview_storage_path='previews/'||preview_sha256||'.jpg')
      or preview_storage_path='originals/'||preview_sha256||case preview_mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' end)
     and preview_byte_length is not null and preview_byte_length between 1 and 2000000))));

do $$begin
 if to_regclass('storage.buckets') is not null then
  update storage.buckets set allowed_mime_types=array['image/jpeg','image/png','image/webp']
   where id='monitoramento-fotos' and not public;
 end if;
end $$;

create or replace function private.monitoring_photo_storage_check(p jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
declare present boolean; size integer; extension text;
begin
 extension:=case p->>'mimeType' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' end;
 if jsonb_typeof(p) is distinct from 'object' or extension is null
  or coalesce(p->>'sha256','') !~ '^[0-9a-f]{64}$'
  or not (coalesce(p->>'storagePath','')='originals/'||(p->>'sha256')||extension
    or (p->>'mimeType'='image/jpeg' and coalesce(p->>'storagePath','')='previews/'||(p->>'sha256')||'.jpg'))
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

-- Change only MIME handling in the existing authorized readers and atomic writers.
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.monitoring_photo_payload(public.monitoring_photos,text)'::regprocedure);
 needle:='''mimeType'',''image/jpeg''';
 if strpos(definition,needle)=0 then raise exception 'PHOTO_ORIGINAL_READER_CHANGED';end if;
 execute replace(definition,needle,'''mimeType'',(p).preview_mime_type');

 definition:=pg_get_functiondef('private.monitoring_ingest_before_photo_storage(jsonb)'::regprocedure);
 needle:='set preview_storage_path=null,preview_byte_length=null,';
 if strpos(definition,needle)=0 then raise exception 'PHOTO_ORIGINAL_INLINE_CHANGED';end if;
 execute replace(definition,needle,'set preview_mime_type=''image/jpeg'',preview_storage_path=null,preview_byte_length=null,');

 definition:=pg_get_functiondef('private.monitoring_ingest_impl(jsonb)'::regprocedure);
 needle:='set preview_base64=null,preview_sha256=preview->>''sha256'',';
 if strpos(definition,needle)=0 then raise exception 'PHOTO_ORIGINAL_INGEST_CHANGED';end if;
 execute replace(definition,needle,'set preview_mime_type=preview->>''mimeType'',preview_base64=null,preview_sha256=preview->>''sha256'',');

 definition:=pg_get_functiondef('private.monitoring_photo_storage(text,jsonb)'::regprocedure);
 needle:='return ''{"photoStorage":true}''';
 if strpos(definition,needle)=0 then raise exception 'PHOTO_ORIGINAL_CAPABILITY_CHANGED';end if;
 execute replace(definition,needle,'return ''{"photoStorage":true,"photoOriginal":true}''');
end $$;
