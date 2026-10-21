-- Select redundant references as a set, instead of repeated per-row lookups.
create or replace function private.monitoring_archive_candidates(p_table text) returns jsonb language plpgsql stable security definer set search_path='' set work_mem='32MB' as $$
declare answer jsonb;cutoff date:=private.monitoring_archive_cutoff();event_from timestamptz:=((cutoff-1)::timestamp at time zone 'America/Sao_Paulo');
begin
 if p_table='public.monitoring_results' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into answer from(select * from public.monitoring_results
   where operational_date<cutoff or(not active and computed_at<clock_timestamp()-interval '1 hour') order by id limit 500) q;
 elsif p_table='public.monitoring_occurrences' then
  with ranked as materialized (
   select oc.file_id,oc.occurrence_key,row_number() over(partition by oc.event_id order by (oc.payload_hash=e.payload_hash) desc,oc.file_id,oc.occurrence_key) position
   from public.monitoring_occurrences oc join public.monitoring_events e on e.id=oc.event_id join public.monitoring_sources s on s.id=e.source_id
   where e.occurred_at>=event_from and e.event_type='punch' and s.kind='afd' and not e.conflicted and not oc.conflict
    and exists(select 1 from private.monitoring_archive_indices i where i.source_id=e.source_id and i.shard=e.nsr::bigint/10000)
  ), candidates as (
   select oc.file_id,oc.occurrence_key from public.monitoring_occurrences oc join public.monitoring_events e on e.id=oc.event_id
    where e.occurred_at<event_from and(e.event_type<>'punch' or exists(select 1 from private.monitoring_archive_indices i where i.source_id=e.source_id and i.shard=e.nsr::bigint/10000))
   union all select file_id,occurrence_key from ranked where position>1
  ) select coalesce(jsonb_agg(to_jsonb(q) order by q.file_id,q.occurrence_key),'[]') into answer from(
   select oc.* from candidates c join public.monitoring_occurrences oc using(file_id,occurrence_key) order by file_id,occurrence_key limit 500) q;
 elsif p_table='public.monitoring_events' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into answer from(select e.* from public.monitoring_events e
   where occurred_at<event_from and not exists(select 1 from public.monitoring_occurrences oc where oc.event_id=e.id)
    and(e.event_type<>'punch' or exists(select 1 from private.monitoring_archive_indices i where i.source_id=e.source_id and i.shard=e.nsr::bigint/10000)) order by id limit 500) q;
 elsif p_table='public.monitoring_audit' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into answer from(select * from public.monitoring_audit where created_at<cutoff::timestamp at time zone 'America/Sao_Paulo' order by id limit 500) q;
 else raise exception 'ARCHIVE_TABLE_FORBIDDEN';end if;
 return answer;
end $$;
