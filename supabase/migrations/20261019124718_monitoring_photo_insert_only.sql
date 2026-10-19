-- A separate payload envelope makes insert-only photo requests fail closed on
-- older database implementations, which do not recognize photoInsertOnly.
-- Existing photo requests intentionally retain their original upsert behavior.
do $migration$
declare
 definition text;
 old_branch text:=$old$ return private.monitoring_ingest_before_source_management(p_data);$old$;
 new_branch text:=$new$ if p_data ? 'photoInsertOnly' then
   if jsonb_typeof(p_data->'photoInsertOnly') is distinct from 'object' then
     raise exception using errcode='22023',message='PHOTO_INVALID';
   end if;
   insert into public.monitoring_photos(source_id,identity_value,sha256,mime_type,base64)
   values(p_data#>>'{photoInsertOnly,sourceId}',p_data#>>'{photoInsertOnly,identityValue}',p_data#>>'{photoInsertOnly,sha256}',p_data#>>'{photoInsertOnly,mimeType}',p_data#>>'{photoInsertOnly,base64}')
   on conflict(source_id,identity_value) do nothing;
   if found then
     return jsonb_build_object('ok',true,'insertOnly',true,'status','inserted','sha256',p_data#>>'{photoInsertOnly,sha256}');
   end if;
   if exists(select 1 from public.monitoring_photos where source_id=p_data#>>'{photoInsertOnly,sourceId}'
     and identity_value=p_data#>>'{photoInsertOnly,identityValue}' and sha256=p_data#>>'{photoInsertOnly,sha256}') then
     return jsonb_build_object('ok',true,'insertOnly',true,'status','replayed','sha256',p_data#>>'{photoInsertOnly,sha256}');
   end if;
   raise exception using errcode='23505',message='PHOTO_ALREADY_EXISTS';
 end if;
 return private.monitoring_ingest_before_source_management(p_data);$new$;
 old_source text:=$old$p_data#>>'{photo,sourceId}',p_data#>>'{source,id}'$old$;
 new_source text:=$new$p_data#>>'{photo,sourceId}',p_data#>>'{photoInsertOnly,sourceId}',p_data#>>'{source,id}'$new$;
 matches integer;
begin
 definition:=pg_get_functiondef('private.monitoring_ingest_impl(jsonb)'::regprocedure);
 if strpos(definition,new_branch)>0 and strpos(definition,new_source)>0 then return; end if;
 if strpos(definition,'photoInsertOnly')>0 then raise exception 'PHOTO_INSERT_ONLY_UNEXPECTED_INGEST_DEFINITION'; end if;
 matches:=(length(definition)-length(replace(definition,old_branch,'')))/length(old_branch);
 if matches<>1 or (length(definition)-length(replace(definition,old_source,'')))/length(old_source)<>1 then raise exception 'PHOTO_INSERT_ONLY_UNEXPECTED_INGEST_DEFINITION'; end if;
 execute replace(replace(definition,old_branch,new_branch),old_source,new_source);
end;
$migration$;
