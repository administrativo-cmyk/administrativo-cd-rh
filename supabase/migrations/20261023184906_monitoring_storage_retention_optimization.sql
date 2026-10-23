-- Automatic caches expire by operational payroll date. Manual decisions, source
-- files and the financial summaries consumed by Banco de Horas never expire here.
create index daily_call_audit_manual_day on private.daily_call_audit(employee_id,operational_date) where actor is not null or action not in ('DECISION','IMPORT');
create index daily_call_audit_auto_day on private.daily_call_audit(employee_id,operational_date,action,id desc) where actor is null and action in ('DECISION','IMPORT');
create index monitoring_audit_auto_day on public.monitoring_audit(target,(detail->>'date'),id desc) where actor is null and action='reprocess';

create function private.monitoring_archive_manual_day(employee uuid,day date) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.daily_call_decisions d where d.employee_id=employee and d.operational_date=day and d.manual_override)
 or exists(select 1 from public.chamada_diaria c where c.colaborador_id=employee and c.data=day and (c.origin='manual' or c.created_by is not null or c.updated_by is not null))
 or exists(select 1 from private.daily_call_audit a where a.employee_id=employee and a.operational_date=day and (a.actor is not null or a.action not in ('DECISION','IMPORT')))
 or exists(select 1 from public.chamada_diaria_auditoria a where a.colaborador_id=employee and a.data=day and a.operacao='CLEAR')
 or exists(select 1 from private.attendance_punch_corrections c where c.employee_id=employee and c.operational_date=day)
$$;
revoke all on function private.monitoring_archive_manual_day(uuid,date) from public,anon,authenticated,service_role;

create function private.monitoring_archive_access_materialized(event uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.monitoring_occurrences o where o.event_id=event
  and not exists(select 1 from private.monitoring_group_files f where f.file_id=o.file_id))
$$;
revoke all on function private.monitoring_archive_access_materialized(uuid) from public,anon,authenticated,service_role;

create or replace function private.monitoring_archive_occurrence_eligible(o public.monitoring_occurrences,e public.monitoring_events) returns boolean
language sql stable security definer set search_path='' as $$
 select case when e.occurred_at<((private.monitoring_archive_cutoff()-1)::timestamp at time zone 'America/Sao_Paulo') then
  case when e.event_type='access' then private.monitoring_archive_access_materialized(e.id)
   else e.event_type<>'punch' or exists(select 1 from private.monitoring_archive_indices i where i.source_id=e.source_id and i.shard=e.nsr::bigint/10000) end
 else not e.conflicted and not o.conflict
  and ((e.event_type='punch' and exists(select 1 from public.monitoring_sources where id=e.source_id and kind='afd')
    and exists(select 1 from private.monitoring_archive_indices i where i.source_id=e.source_id and i.shard=e.nsr::bigint/10000))
   or (e.event_type='access' and exists(select 1 from public.monitoring_sources where id=e.source_id and kind='defense-access') and private.monitoring_archive_access_materialized(e.id)))
  and exists(select 1 from public.monitoring_occurrences other where other.event_id=o.event_id and not other.conflict
   and ((other.payload_hash=e.payload_hash and o.payload_hash<>e.payload_hash)
    or ((other.payload_hash=e.payload_hash)=(o.payload_hash=e.payload_hash) and (other.file_id,other.occurrence_key)<(o.file_id,o.occurrence_key)))) end
$$;

alter function private.monitoring_archive_candidates(text) rename to monitoring_archive_candidates_before_storage;
create function private.monitoring_archive_candidates(p_table text) returns jsonb
language plpgsql stable security definer set search_path='' set work_mem='32MB' as $$
declare answer jsonb;cutoff date:=private.monitoring_archive_cutoff();event_from timestamptz:=((cutoff-1)::timestamp at time zone 'America/Sao_Paulo');
begin
 if p_table='private.daily_call_decisions' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.employee_id,q.operational_date),'[]') into answer from(
   select * from private.daily_call_decisions d where operational_date<cutoff and not manual_override
    and not private.monitoring_archive_manual_day(employee_id,operational_date) order by employee_id,operational_date limit 500) q;
 elsif p_table='private.daily_call_audit' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into answer from(
   select a.* from private.daily_call_audit a where actor is null and action in ('DECISION','IMPORT')
    and (operational_date<cutoff or exists(select 1 from private.daily_call_audit newer where newer.employee_id=a.employee_id and newer.operational_date=a.operational_date and newer.action=a.action and newer.actor is null and newer.id>a.id))
    and not private.monitoring_archive_manual_day(employee_id,operational_date) order by id limit 500) q;
 elsif p_table='public.monitoring_audit' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into answer from(
   select a.* from public.monitoring_audit a where actor is null and action='reprocess'
    and case when pg_input_is_valid(detail->>'date','date') then (detail->>'date')::date<cutoff
     or exists(select 1 from public.monitoring_audit newer where newer.target=a.target and newer.detail->>'date'=a.detail->>'date' and newer.actor is null and newer.action='reprocess' and newer.id>a.id) else false end order by id limit 500) q;
 elsif p_table='public.monitoring_results' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into answer from(
   select * from public.monitoring_results r where
    (operational_date<cutoff and summary#>>'{bankDay,state}' is distinct from 'ready')
    or(not active and computed_at<clock_timestamp()-interval '1 hour') order by id limit 500) q;
 elsif p_table='public.monitoring_occurrences' then
  with ranked as materialized (
   select oc.file_id,oc.occurrence_key,row_number() over(partition by oc.event_id order by (oc.payload_hash=e.payload_hash) desc,oc.file_id,oc.occurrence_key) position
   from public.monitoring_occurrences oc join public.monitoring_events e on e.id=oc.event_id join public.monitoring_sources s on s.id=e.source_id
   where e.occurred_at>=event_from and not e.conflicted and not oc.conflict
    and ((e.event_type='punch' and s.kind='afd' and exists(select 1 from private.monitoring_archive_indices i where i.source_id=e.source_id and i.shard=e.nsr::bigint/10000))
     or(e.event_type='access' and s.kind='defense-access' and private.monitoring_archive_access_materialized(e.id)))
  ), candidates as (
   select oc.file_id,oc.occurrence_key from public.monitoring_occurrences oc join public.monitoring_events e on e.id=oc.event_id
    where e.occurred_at<event_from and private.monitoring_archive_occurrence_eligible(oc,e)
   union all select file_id,occurrence_key from ranked where position>1
  ) select coalesce(jsonb_agg(to_jsonb(q) order by q.file_id,q.occurrence_key),'[]') into answer from(
   select oc.* from candidates c join public.monitoring_occurrences oc using(file_id,occurrence_key) order by file_id,occurrence_key limit 500) q;
 else return private.monitoring_archive_candidates_before_storage(p_table);end if;
 return answer;
end $$;
revoke all on function private.monitoring_archive_candidates(text),private.monitoring_archive_candidates_before_storage(text) from public,anon,authenticated,service_role;

alter function private.monitoring_archive_page_matches(text,jsonb) rename to monitoring_archive_page_matches_before_storage;
create function private.monitoring_archive_page_matches(p_table text,p_rows jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare n bigint;cutoff date:=private.monitoring_archive_cutoff();
begin
 if p_table='private.daily_call_decisions' then
  select count(*) into n from jsonb_populate_recordset(null::private.daily_call_decisions,p_rows) x join private.daily_call_decisions y using(employee_id,operational_date)
   where to_jsonb(x)=to_jsonb(y) and y.operational_date<cutoff and not y.manual_override and not private.monitoring_archive_manual_day(y.employee_id,y.operational_date);
 elsif p_table='private.daily_call_audit' then
  select count(*) into n from jsonb_populate_recordset(null::private.daily_call_audit,p_rows) x join private.daily_call_audit y using(id)
   where to_jsonb(x)=to_jsonb(y) and y.actor is null and y.action in ('DECISION','IMPORT') and not private.monitoring_archive_manual_day(y.employee_id,y.operational_date)
    and (y.operational_date<cutoff or exists(select 1 from private.daily_call_audit newer where newer.employee_id=y.employee_id and newer.operational_date=y.operational_date and newer.action=y.action and newer.actor is null and newer.id>y.id));
 elsif p_table='public.monitoring_audit' then
  select count(*) into n from jsonb_populate_recordset(null::public.monitoring_audit,p_rows) x join public.monitoring_audit y using(id)
   where to_jsonb(x)=to_jsonb(y) and y.actor is null and y.action='reprocess'
    and case when pg_input_is_valid(y.detail->>'date','date') then (y.detail->>'date')::date<cutoff
     or exists(select 1 from public.monitoring_audit newer where newer.target=y.target and newer.detail->>'date'=y.detail->>'date' and newer.actor is null and newer.action='reprocess' and newer.id>y.id) else false end;
 elsif p_table='public.monitoring_results' then
  select count(*) into n from jsonb_populate_recordset(null::public.monitoring_results,p_rows) x join public.monitoring_results y using(id)
   where to_jsonb(x)=to_jsonb(y) and ((y.operational_date<cutoff and y.summary#>>'{bankDay,state}' is distinct from 'ready') or(not y.active and y.computed_at<clock_timestamp()-interval '1 hour'));
 else return private.monitoring_archive_page_matches_before_storage(p_table,p_rows);end if;
 return n=jsonb_array_length(p_rows);
end $$;
revoke all on function private.monitoring_archive_page_matches(text,jsonb),private.monitoring_archive_page_matches_before_storage(text,jsonb) from public,anon,authenticated,service_role;

-- Extend the existing immutable upload / reread / exact-row proof protocol.
-- Lock employee-days exactly as the manual attendance workflow does.
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.monitoring_archive_worker_impl(text,jsonb)'::regprocedure);
 needle:='array[''public.monitoring_results'',''public.monitoring_occurrences'',''public.monitoring_events'',''public.monitoring_audit'']';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_STORAGE_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,'array[''public.monitoring_results'',''public.monitoring_occurrences'',''public.monitoring_events'',''public.monitoring_audit'',''private.daily_call_audit'',''private.daily_call_decisions'']');
 needle:='if not private.monitoring_archive_page_matches(t,rows) then';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_STORAGE_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,$patch$
 if t in ('private.daily_call_audit','private.daily_call_decisions') then
  perform pg_advisory_xact_lock(hashtext(x.employee_id::text),hashtext(x.operational_date::text))
   from (select distinct (v->>'employee_id')::uuid employee_id,(v->>'operational_date')::date operational_date from jsonb_array_elements(rows) v) x order by x.employee_id,x.operational_date;
 end if;
 if not private.monitoring_archive_page_matches(t,rows) then
 $patch$);
 needle:='else'||chr(10)||'  execute format(''delete from %s y using jsonb_populate_recordset';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_STORAGE_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,$patch$elsif t='private.daily_call_decisions' then
  delete from private.daily_call_decisions y using jsonb_populate_recordset(null::private.daily_call_decisions,rows) x where x.employee_id=y.employee_id and x.operational_date=y.operational_date and to_jsonb(x)=to_jsonb(y);
 else
  execute format('delete from %s y using jsonb_populate_recordset$patch$);
 execute definition;
end $$;

-- This ordered index covers the same created_at range lookups and can scan in
-- either direction. Keep the PK, event uniqueness, NSR and all identity indexes.
drop index if exists public.monitoring_archive_audit_time;
