-- Keep the existing small portrait and its hash intact. The larger rendition
-- is used only by an authorized full-photo read and only for that thumbnail.
set local lock_timeout='5s';
alter table public.monitoring_photos
 add column preview_base64 text,
 add column preview_sha256 text,
 add column preview_thumbnail_sha256 text,
 add constraint monitoring_photo_preview_valid check (
  (preview_base64 is null and preview_sha256 is null and preview_thumbnail_sha256 is null)
  or (preview_base64 is not null and length(preview_base64) between 1 and 2800000
   and preview_sha256 is not null and preview_sha256 ~ '^[0-9a-f]{64}$'
   and preview_thumbnail_sha256 is not null and preview_thumbnail_sha256 ~ '^[0-9a-f]{64}$'));

create function private.monitoring_photo_payload(p public.monitoring_photos,p_variant text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select case when p_variant='full' and (p).preview_thumbnail_sha256=(p).sha256 and (p).preview_base64 is not null
  then jsonb_build_object('mimeType','image/jpeg','base64',(p).preview_base64,'sha256',(p).preview_sha256)
  else jsonb_build_object('mimeType',(p).mime_type,'base64',(p).base64,'sha256',(p).sha256) end;
$$;
revoke all on function private.monitoring_photo_payload(public.monitoring_photos,text) from public,anon,authenticated,service_role;

create function private.monitoring_employee_photo(p_employee uuid,p_variant text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.monitoring_photo_payload(p,p_variant)
 from public.monitoring_bindings b
 join public.monitoring_sources bs on bs.id=b.source_id
 join public.monitoring_sources ps on ps.identity_namespace=bs.identity_namespace
 join public.monitoring_photos p on p.source_id=ps.id and p.identity_value=b.identity_value
 where b.employee_id=p_employee and b.revoked_at is null
  and (now() at time zone 'America/Sao_Paulo')::date between b.valid_from and coalesce(b.valid_to,'9999-12-31')
  and ((b.identity_type='defense' and bs.kind in ('defense-person','defense-access') and ps.kind in ('defense-person','defense-access'))
   or (b.identity_type='cpf' and bs.kind='afd' and ps.kind='afd' and private.monitoring_identifier_valid(b.identity_value,'cpf')))
 order by case b.identity_type when 'defense' then 0 else 1 end,p.updated_at desc,p.source_id,p.identity_value,b.id
 limit 1;
$$;
revoke all on function private.monitoring_employee_photo(uuid,text) from public,anon,authenticated,service_role;

-- Preserve the existing authorization and own-profile resolution in every
-- versioned query implementation that contains the original photo lookup.
do $$declare signature regprocedure; definition text; matched integer:=0;begin
 for signature in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.prokind='f' and strpos(p.prosrc,'private.monitoring_employee_photo(employee)')>0 loop
  definition:=pg_get_functiondef(signature);
  execute replace(definition,'private.monitoring_employee_photo(employee)','private.monitoring_employee_photo(employee,p_data->>''photoVariant'')');
  matched:=matched+1;
 end loop;
 if matched=0 then raise exception 'PHOTO_PREVIEW_QUERY_CHANGED';end if;
end $$;

create function private.monitoring_identity_photo(p_source_id text,p_identity_value text,p_variant text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.monitoring_identity_photo(p_source_id,p_identity_value);
 if result is null or p_variant is distinct from 'full' then return result;end if;
 select private.monitoring_photo_payload(p,p_variant) into result
 from public.monitoring_sources requested
 join public.monitoring_sources source on source.identity_namespace=requested.identity_namespace
 join public.monitoring_photos p on p.source_id=source.id and p.identity_value=p_identity_value
 where requested.id=p_source_id and requested.kind in ('defense-person','defense-access') and source.kind='defense-person'
 order by (p.source_id=p_source_id) desc,p.source_id limit 1;
 return result;
end $$;
revoke all on function private.monitoring_identity_photo(text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_identity_photo(text,text,text) to authenticated;
create function public.monitoring_identity_photo(p_source_id text,p_identity_value text,p_variant text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.monitoring_identity_photo(p_source_id,p_identity_value,p_variant);
$$;
revoke all on function public.monitoring_identity_photo(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.monitoring_identity_photo(text,text,text) to authenticated;

-- A distinct envelope fails closed on deployments without this capability.
-- The old ingestion implementation still checks source permissions and owns
-- insert-only conflict detection. Both renditions commit in one transaction.
alter function private.monitoring_ingest_impl(jsonb) rename to monitoring_ingest_before_photo_previews;
create function private.monitoring_ingest_impl(p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; thumbnail jsonb; preview jsonb; result jsonb;
begin
 if not (p_data ? 'photoWithPreview') then return private.monitoring_ingest_before_photo_previews(p_data);end if;
 payload:=p_data->'photoWithPreview';thumbnail:=payload->'thumbnail';preview:=payload->'preview';
 if jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(thumbnail) is distinct from 'object'
  or jsonb_typeof(preview) is distinct from 'object' or preview->>'mimeType' is distinct from 'image/jpeg'
  or coalesce(preview->>'sha256','') !~ '^[0-9a-f]{64}$'
  or coalesce(length(preview->>'base64'),0) not between 1 and 2800000
  or encode(sha256(decode(preview->>'base64','base64')),'hex') is distinct from preview->>'sha256'
  then raise exception using errcode='22023',message='PHOTO_PREVIEW_INVALID';end if;
 if payload ? 'expectedThumbnailSha256' then
  perform 1 from public.monitoring_photos p where p.source_id=thumbnail->>'sourceId' and p.identity_value=thumbnail->>'identityValue'
   and p.sha256=payload->>'expectedThumbnailSha256' for update;
  if not found then raise exception using errcode='23505',message='PHOTO_ALREADY_EXISTS';end if;
 end if;
 result:=private.monitoring_ingest_before_photo_previews(jsonb_build_object(
  case when payload->>'insertOnly'='true' then 'photoInsertOnly' else 'photo' end,thumbnail));
 if payload->>'insertOnly'='true' and exists(select 1 from public.monitoring_photos p
  where p.source_id=thumbnail->>'sourceId' and p.identity_value=thumbnail->>'identityValue'
   and p.preview_thumbnail_sha256=p.sha256 and p.preview_sha256 is distinct from preview->>'sha256')
  then raise exception using errcode='23505',message='PHOTO_ALREADY_EXISTS';end if;
 update public.monitoring_photos p set preview_base64=preview->>'base64',preview_sha256=preview->>'sha256',preview_thumbnail_sha256=p.sha256
 where p.source_id=thumbnail->>'sourceId' and p.identity_value=thumbnail->>'identityValue' and p.sha256=thumbnail->>'sha256';
 if not found then raise exception 'PHOTO_PREVIEW_NOT_STORED';end if;
 return result||jsonb_build_object('previewStored',true);
end $$;
revoke all on function private.monitoring_ingest_impl(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_ingest_impl(jsonb) to service_role;
