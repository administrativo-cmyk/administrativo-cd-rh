-- AFD export encoding is independent of its timestamp layout. The worker detects
-- the encoding from the stored bytes before freezing this contract.
do $$
declare definition text; old_value text:='''encoding'',case when v_profile=''legacy'' then ''latin1'' else ''utf8'' end';
begin
 definition:=pg_get_functiondef('private.monitoring_cloud_worker_before_documents(text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,old_value,'')))/length(old_value)<>1 then raise exception 'AFD_ENCODING_PATCH_CHANGED';end if;
 definition:=replace(definition,old_value,$patch$'encoding',case when p_data->>'encoding' in ('utf8','latin1') then p_data->>'encoding' when v_profile='legacy' then 'latin1' else 'utf8' end$patch$);
 execute definition;
end $$;

-- Count only occurrences inserted by this transaction. Replays retain the same
-- cursor, event identity and immutable batch plan; previous file counters remain.
do $$
declare definition text; needle text; replacement text; start_at integer; end_at integer;
begin
 definition:=replace(pg_get_functiondef('private.monitoring_ingest_before_source_management(jsonb)'::regprocedure),E'\r\n',E'\n');
 needle:='v_batch_hash text;';
 if strpos(definition,needle)=0 then raise exception 'AFD_COUNTER_DECLARATION_CHANGED';end if;
 definition:=replace(definition,needle,needle||' v_added integer:=0; v_accepted integer:=0; v_event_rows integer:=0; v_rejected integer:=0; v_conflict_rows integer:=0; v_batch_event_ids uuid[]:=array[]::uuid[];');
 needle:=$old$values(f,o->>'key',(o->>'line')::integer,o->>'sheet',o->>'payloadHash',v_event,o,v_conflict) on conflict do nothing;$old$;
 replacement:=needle||$patch$
   if found then
    v_added:=v_added+1;
    if exists(select 1 from jsonb_array_elements(coalesce(o->'issues','[]')) i where i->>'severity'='error') then
     v_rejected:=v_rejected+1;
    elsif o ? 'event' or o ? 'person' then v_accepted:=v_accepted+1;end if;
    if v_event is not null and not v_conflict then v_event_rows:=v_event_rows+1;end if;
    if v_conflict then v_conflict_rows:=v_conflict_rows+1;end if;
   end if;
   if v_event is not null then v_batch_event_ids:=array_append(v_batch_event_ids,v_event);end if;
$patch$;
 if strpos(definition,needle)=0 then raise exception 'AFD_OCCURRENCE_INSERT_CHANGED';end if;
 definition:=replace(definition,needle,replacement);
 needle:=' update public.monitoring_files set processed_rows=';
 start_at:=strpos(definition,needle);
 end_at:=strpos(definition,' update public.monitoring_files set completed_at=');
 if start_at=0 or end_at<=start_at then raise exception 'AFD_COUNTER_SECTION_CHANGED';end if;
 replacement:=$patch$ update public.monitoring_files set processed_rows=processed_rows+v_added,
 accepted_rows=accepted_rows+v_accepted,new_events=new_events+v_new,
 repeated_events=greatest(0,repeated_events+v_event_rows-v_new),
 conflict_rows=conflict_rows+v_conflict_rows,rejected_rows=rejected_rows+v_rejected,
 status=case when processed_rows+v_added=expected_rows
 and exists(select 1 from public.monitoring_batches where file_id=f and final)
 then case when conflict_rows+v_conflict_rows>0 then 'conflict' else 'complete' end else 'processing' end
 where id=f;
$patch$;
 definition:=substr(definition,1,start_at-1)||replacement||substr(definition,end_at);
 -- Invalidate only dates touched by this batch, not every date already read
 -- from a full-history export. The original events/occurrences are preserved.
 needle:='join public.monitoring_occurrences oc on oc.event_id=ev.id and oc.file_id=f';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'AFD_BATCH_SCOPE_CHANGED';end if;
 definition:=replace(definition,needle,'join (select unnest(v_batch_event_ids) as event_id) batch_events on batch_events.event_id=ev.id');
 -- Enqueue the exact employees and neighboring operational dates from this batch.
 -- This also handles shifts ending on the following calendar day.
 start_at:=strpos(definition,'   perform private.monitoring_enqueue(null,(select min(');
 end_at:=strpos(substr(definition,start_at),E'\n end if;');
 if start_at=0 or end_at=0 then raise exception 'AFD_ENQUEUE_SECTION_CHANGED';end if;
 replacement:=$patch$   insert into public.monitoring_jobs(employee_id,operational_date,reason)
   select distinct b.employee_id,(ev.occurred_at at time zone 'America/Sao_Paulo')::date+delta.n,'Dados ou regras alterados'
   from public.monitoring_events ev
   join public.monitoring_sources es on es.id=ev.source_id
   join public.monitoring_sources bs on bs.identity_namespace=es.identity_namespace
   join public.monitoring_bindings b on b.source_id=bs.id and b.identity_type=ev.identity_type and b.identity_value=ev.identity_value
   cross join (values(-1),(0),(1)) delta(n)
   where ev.id=any(v_batch_event_ids) and b.revoked_at is null
    and (ev.occurred_at at time zone 'America/Sao_Paulo')::date between b.valid_from and coalesce(b.valid_to,'9999-12-31')
   on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
$patch$;
 definition:=substr(definition,1,start_at-1)||replacement||substr(definition,start_at+end_at-1);
 -- Once the file finishes, revisit declared collection days even for people
 -- without a punch. Never expand coverage from the observed first/last record.
 needle:=' return jsonb_build_object(''ok'',true,''fileId'',f,''rows'',v_rows';
 if strpos(definition,needle)=0 then raise exception 'AFD_INGEST_RETURN_CHANGED';end if;
 replacement:=$patch$ if (p_data#>>'{batch,final}')::boolean and exists(select 1 from public.monitoring_files where id=f and status in ('complete','conflict')) then
  insert into public.monitoring_jobs(employee_id,operational_date,reason)
  select distinct b.employee_id,d::date,'Revisao da Chamada por cobertura de ponto'
  from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
  join public.monitoring_sources src on src.identity_namespace=bs.identity_namespace join public.colaboradores c on c.id=b.employee_id
  cross join lateral generate_series(
   greatest((src.configuration#>>'{declaredCoverage,from}')::timestamptz at time zone 'America/Sao_Paulo',b.valid_from::timestamp,c.admissao::timestamp),
   least((src.configuration#>>'{declaredCoverage,to}')::timestamptz at time zone 'America/Sao_Paulo',coalesce(b.valid_to,'9999-12-31')::timestamp,(now() at time zone 'America/Sao_Paulo')::date::timestamp),interval '1 day') d
  where b.revoked_at is null and b.identity_type in ('cpf','pis') and src.id=s and src.kind='afd'
   and src.configuration->>'sourceIdentityConfirmed'='true' and src.configuration#>>'{declaredCoverage,continuous}'='true'
   and c.ativo_no_sistema and c.admissao is not null
   and exists(select 1 from private.schedule_window_rows(b.employee_id,d::date,d::date) ms where ms.kind='schedule' and ms.target=b.employee_id::text and ms.revoked_at is null
    and ms.valid_from<=d::date and (ms.valid_to is null or ms.valid_to>=d::date) and ms.payload->'days' @> to_jsonb(array[extract(dow from d)::integer]))
  on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
 end if;
$patch$||needle;
 definition:=replace(definition,needle,replacement);
 execute definition;
end $$;

-- Explicit ADMIN/RH retry may restart an exhausted transient-error allowance,
-- while retaining committed batches and the original snapshot. Automatic retry
-- is still capped at five attempts. Other failures keep their existing guard.
do $$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('private.monitoring_cloud_admin_before_detection(text,jsonb)'::regprocedure);
 needle:='if job.status<>''failed'' or job.attempts>=5 then';
 if strpos(definition,needle)=0 then raise exception 'AFD_RETRY_GUARD_CHANGED';end if;
 definition:=replace(definition,needle,$patch$if job.status<>'failed' or (job.attempts>=5 and coalesce(job.last_error,'') not in ('CLOUD_UNAVAILABLE','CLOUD_PROCESSING_FAILED','CLOUD_DOWNLOAD_FAILED','CLOUD_ROUND_ABORTED','CLOUD_ROUND_DEADLINE_EXCEEDED')) then$patch$);
 needle:='set status=''queued'',retry_pending=true,next_retry_at=clock_timestamp(),last_error=null,';
 if strpos(definition,needle)=0 then raise exception 'AFD_RETRY_UPDATE_CHANGED';end if;
 definition:=replace(definition,needle,'set status=''queued'',attempts=case when attempts>=5 then 0 else attempts end,retry_pending=true,next_retry_at=clock_timestamp(),last_error=null,');
 execute definition;
end $$;
