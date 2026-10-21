-- Keep each recent canonical punch in Postgres; repeated file references live
-- in the verified archive. Conflicting evidence remains in the operational DB.
create function private.monitoring_archive_occurrence_eligible(o public.monitoring_occurrences,e public.monitoring_events) returns boolean
language sql stable security definer set search_path='' as $$
 select case when e.occurred_at<((private.monitoring_archive_cutoff()-1)::timestamp at time zone 'America/Sao_Paulo') then
  e.event_type<>'punch' or exists(select 1 from private.monitoring_archive_indices i where i.source_id=e.source_id and i.shard=e.nsr::bigint/10000)
 else e.event_type='punch' and not e.conflicted and not o.conflict
  and exists(select 1 from public.monitoring_sources where id=e.source_id and kind='afd')
  and exists(select 1 from private.monitoring_archive_indices i where i.source_id=e.source_id and i.shard=e.nsr::bigint/10000)
  and exists(select 1 from public.monitoring_occurrences other where other.event_id=o.event_id and not other.conflict
   and ((other.payload_hash=e.payload_hash and o.payload_hash<>e.payload_hash)
    or ((other.payload_hash=e.payload_hash)=(o.payload_hash=e.payload_hash) and (other.file_id,other.occurrence_key)<(o.file_id,o.occurrence_key)))) end
$$;
revoke all on function private.monitoring_archive_occurrence_eligible(public.monitoring_occurrences,public.monitoring_events) from public,anon,authenticated,service_role;
do $$declare fn text;definition text;needle text;replacement text;alias_name text;begin
 needle:='e\.occurred_at<event_from\s+and\s+\(e\.event_type<>''punch'' or exists\(select 1 from private\.monitoring_archive_indices i\s+where i\.source_id=e\.source_id and i\.shard=e\.nsr::bigint/10000\)\)';
 foreach fn in array array['private.monitoring_archive_candidates(text)','private.monitoring_archive_page_matches(text,jsonb)'] loop
  definition:=pg_get_functiondef(fn::regprocedure);alias_name:=case when fn like '%candidates%' then 'oc' else 'y' end;
  replacement:=regexp_replace(definition,needle,'private.monitoring_archive_occurrence_eligible('||alias_name||',e)','g');
  if replacement=definition then raise exception 'ARCHIVE_DUPLICATE_PATCH_CHANGED';end if;execute replacement;
 end loop;
 definition:=pg_get_functiondef('private.monitoring_archive_worker_impl(text,jsonb)'::regprocedure);
 needle:='insert into private.monitoring_archive_retained(path,table_name,rows) values(object.path,t,n);';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_DUPLICATE_PATCH_CHANGED';end if;
 execute replace(definition,needle,$patch$
 if t='public.monitoring_occurrences' then
  update public.monitoring_files f set archived_rows=f.archived_rows+q.n from
   (select file_id,count(*)::integer n from jsonb_populate_recordset(null::public.monitoring_occurrences,rows) group by file_id) q where f.id=q.file_id;
 end if;
 insert into private.monitoring_archive_retained(path,table_name,rows) values(object.path,t,n);
 $patch$);
end $$;

create or replace function private.monitoring_archive_skip_cold(p_batch jsonb,p_row jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare context text;cold boolean;duplicate boolean;
begin
 if not (select active from private.monitoring_archive_control where id) or p_batch#>>'{source,kind}'<>'afd' or coalesce(p_row#>>'{event,type}','')<>'punch' then return false;end if;
 cold:=(p_row#>>'{event,timestamp}')::timestamptz<((private.monitoring_archive_cutoff()-1)::timestamp at time zone 'America/Sao_Paulo');
 duplicate:=not cold and exists(select 1 from public.monitoring_events e where e.source_id=p_batch#>>'{source,id}' and e.nsr=p_row#>>'{event,nsr}' and not e.conflicted and e.payload_hash=p_row->>'payloadHash');
 if not cold and not duplicate then return false;end if;
 context:=(p_batch#>>'{source,id}')||':'||(p_batch#>>'{file,sha256}')||':'||(p_batch#>>'{file,parserVersion}');
 if current_setting('app.monitoring_archive_cloud_file',true) is distinct from context then
  if cold then raise exception 'ARCHIVE_CLOUD_REQUIRED';else return false;end if;
 end if;
 if not exists(select 1 from private.monitoring_archive_files where source_id=p_batch#>>'{source,id}' and sha256=p_batch#>>'{file,sha256}' and parser_version=p_batch#>>'{file,parserVersion}') then raise exception 'ARCHIVE_FILE_REQUIRED';end if;
 return true;
end $$;
do $$declare definition text;needle text:='v_archived:=v_archived+1;';begin
 definition:=pg_get_functiondef('private.monitoring_ingest_before_source_management(jsonb)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_DUPLICATE_PATCH_CHANGED';end if;
 execute replace(definition,needle,needle||'if (o#>>''{event,timestamp}'')::timestamptz>=((private.monitoring_archive_cutoff()-1)::timestamp at time zone ''America/Sao_Paulo'') then v_event_rows:=v_event_rows+1;end if;');
end $$;
