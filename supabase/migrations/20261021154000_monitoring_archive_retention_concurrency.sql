-- Newly obsolete rows must not invalidate an unrelated page already copied.
create function private.monitoring_archive_page_matches(p_table text,p_rows jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
declare n bigint; cutoff date:=private.monitoring_archive_cutoff();event_from timestamptz:=((cutoff-1)::timestamp at time zone 'America/Sao_Paulo');
begin
 if p_table='public.monitoring_results' then
  select count(*) into n from jsonb_populate_recordset(null::public.monitoring_results,p_rows) x join public.monitoring_results y using(id)
   where to_jsonb(x)=to_jsonb(y) and (y.operational_date<cutoff or (not y.active and y.computed_at<clock_timestamp()-interval '1 hour'));
 elsif p_table='public.monitoring_occurrences' then
  select count(*) into n from jsonb_populate_recordset(null::public.monitoring_occurrences,p_rows) x join public.monitoring_occurrences y using(file_id,occurrence_key)
   join public.monitoring_events e on e.id=y.event_id where to_jsonb(x)=to_jsonb(y) and e.occurred_at<event_from
   and (e.event_type<>'punch' or exists(select 1 from private.monitoring_archive_indices i where i.source_id=e.source_id and i.shard=e.nsr::bigint/10000));
 elsif p_table='public.monitoring_events' then
  select count(*) into n from jsonb_populate_recordset(null::public.monitoring_events,p_rows) x join public.monitoring_events y using(id)
   where to_jsonb(x)=to_jsonb(y) and y.occurred_at<event_from and not exists(select 1 from public.monitoring_occurrences oc where oc.event_id=y.id)
   and (y.event_type<>'punch' or exists(select 1 from private.monitoring_archive_indices i where i.source_id=y.source_id and i.shard=y.nsr::bigint/10000));
 elsif p_table='public.monitoring_audit' then
  select count(*) into n from jsonb_populate_recordset(null::public.monitoring_audit,p_rows) x join public.monitoring_audit y using(id)
   where to_jsonb(x)=to_jsonb(y) and y.created_at<cutoff::timestamp at time zone 'America/Sao_Paulo';
 else raise exception 'ARCHIVE_TABLE_FORBIDDEN';end if;
 return n=jsonb_array_length(p_rows);
end $$;
revoke all on function private.monitoring_archive_page_matches(text,jsonb) from public,anon,authenticated,service_role;
do $$declare definition text;needle text:='if private.monitoring_archive_candidates(t) is distinct from rows then';begin
 definition:=pg_get_functiondef('private.monitoring_archive_worker_impl(text,jsonb)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_RETENTION_PATCH_CHANGED';end if;
 execute replace(definition,needle,'if not private.monitoring_archive_page_matches(t,rows) then');
end $$;
