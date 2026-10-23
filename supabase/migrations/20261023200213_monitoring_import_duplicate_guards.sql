-- Compare logical events after storage normalization. Comparing the compact JSON
-- directly loses the identity/NSR fields and misclassifies a legacy/ISO re-export.
do $$
declare definition text; needle text:='private.monitoring_cross_format_punch_equal(payload,e)';
begin
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(791704);
 definition:=pg_get_functiondef('private.monitoring_ingest_before_source_management(jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
  raise exception 'DUPLICATE_INGEST_DEFINITION_CHANGED';
 end if;
 execute replace(definition,needle,'private.monitoring_cross_format_punch_equal(private.monitoring_event_payload(monitoring_events),e)');
end $$;

-- A verified cloud original already preserves the repeated row. Skip both exact
-- repeats and an equivalent lower-precision export before inserting a reference.
-- A more precise punch still reaches ingestion to refine its canonical timestamp.
create or replace function private.monitoring_archive_skip_cold(p_batch jsonb,p_row jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare context text;cold boolean;duplicate boolean;
begin
 if not (select active from private.monitoring_archive_control where id) or p_batch#>>'{source,kind}'<>'afd' or coalesce(p_row#>>'{event,type}','')<>'punch' then return false;end if;
 cold:=(p_row#>>'{event,timestamp}')::timestamptz<((private.monitoring_archive_cutoff()-1)::timestamp at time zone 'America/Sao_Paulo');
 duplicate:=not cold and exists(
  select 1 from public.monitoring_events e
  where e.source_id=p_batch#>>'{source,id}' and e.event_type='punch' and e.nsr=p_row#>>'{event,nsr}' and not e.conflicted
   and (e.payload_hash=p_row->>'payloadHash'
    or (private.monitoring_cross_format_punch_equal(private.monitoring_event_payload(e),p_row->'event')
     and (e.payload->>'precisionSeconds')::numeric<=(p_row#>>'{event,precisionSeconds}')::numeric))
 );
 if not cold and not duplicate then return false;end if;
 context:=(p_batch#>>'{source,id}')||':'||(p_batch#>>'{file,sha256}')||':'||(p_batch#>>'{file,parserVersion}');
 if current_setting('app.monitoring_archive_cloud_file',true) is distinct from context then
  if cold then raise exception 'ARCHIVE_CLOUD_REQUIRED';else return false;end if;
 end if;
 if not exists(select 1 from private.monitoring_archive_files where source_id=p_batch#>>'{source,id}' and sha256=p_batch#>>'{file,sha256}' and parser_version=p_batch#>>'{file,parserVersion}') then raise exception 'ARCHIVE_FILE_REQUIRED';end if;
 return true;
end $$;
revoke all on function private.monitoring_archive_skip_cold(jsonb,jsonb) from public,anon,authenticated,service_role;
