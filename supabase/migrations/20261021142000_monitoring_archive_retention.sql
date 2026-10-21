-- Each removal requires an immutable, reread and checksummed cloud object.
create table private.monitoring_archive_retention (
 id boolean primary key default true check(id), checked_at timestamptz not null default '-infinity', pending boolean not null default true
);
insert into private.monitoring_archive_retention default values;
create table private.monitoring_archive_retained (
 path text primary key references private.monitoring_archive_objects, table_name text not null, rows integer not null check(rows>0), committed_at timestamptz not null default clock_timestamp()
);
alter table private.monitoring_archive_retention enable row level security;
alter table private.monitoring_archive_retained enable row level security;
revoke all on private.monitoring_archive_retention,private.monitoring_archive_retained from public,anon,authenticated,service_role;

create function private.monitoring_archive_candidates(p_table text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare answer jsonb; cutoff date:=private.monitoring_archive_cutoff(); event_from timestamptz:=((cutoff-1)::timestamp at time zone 'America/Sao_Paulo');
begin
 if p_table='public.monitoring_results' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into answer from (select * from public.monitoring_results
   where operational_date<cutoff or (not active and computed_at<clock_timestamp()-interval '1 hour') order by id limit 100) q;
 elsif p_table='public.monitoring_occurrences' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.file_id,q.occurrence_key),'[]') into answer from (
   select oc.* from public.monitoring_occurrences oc join public.monitoring_events e on e.id=oc.event_id
   where e.occurred_at<event_from and (e.event_type<>'punch' or exists(select 1 from private.monitoring_archive_indices i
    where i.source_id=e.source_id and i.shard=e.nsr::bigint/10000)) order by oc.file_id,oc.occurrence_key limit 100) q;
 elsif p_table='public.monitoring_events' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into answer from (select e.* from public.monitoring_events e
   where occurred_at<event_from and not exists(select 1 from public.monitoring_occurrences oc where oc.event_id=e.id)
   and (e.event_type<>'punch' or exists(select 1 from private.monitoring_archive_indices i where i.source_id=e.source_id and i.shard=e.nsr::bigint/10000)) order by id limit 100) q;
 elsif p_table='public.monitoring_audit' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into answer from (select * from public.monitoring_audit where created_at<cutoff::timestamp at time zone 'America/Sao_Paulo' order by id limit 100) q;
 else raise exception 'ARCHIVE_TABLE_FORBIDDEN';end if;
 return answer;
end $$;
revoke all on function private.monitoring_archive_candidates(text) from public,anon,authenticated,service_role;

create function private.monitoring_archive_retention_due() returns boolean language sql stable security definer set search_path='' as $$
 select c.active and not c.maintenance and (r.checked_at<clock_timestamp()-interval '15 minutes' or (r.pending and r.checked_at<clock_timestamp()-interval '1 minute'))
 from private.monitoring_archive_control c cross join private.monitoring_archive_retention r where c.id and r.id
$$;
revoke all on function private.monitoring_archive_retention_due() from public,anon,authenticated,service_role;

alter function private.monitoring_archive_worker_impl(text,jsonb) rename to monitoring_archive_worker_before_retention;
create function private.monitoring_archive_worker_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.monitoring_archive_control; object private.monitoring_archive_objects; t text; rows jsonb; raw text; n bigint; expected integer;
 tables constant text[]:=array['public.monitoring_results','public.monitoring_occurrences','public.monitoring_events','public.monitoring_audit'];
begin
 if p_action not in ('retention_page','retention_commit','retention_done') then return private.monitoring_archive_worker_before_retention(p_action,p_data);end if;
 select * into c from private.monitoring_archive_control where id;
 if not c.active or c.maintenance then raise exception 'ARCHIVE_STATE';end if;
 if p_action='retention_done' then
  update private.monitoring_archive_retention set checked_at=clock_timestamp(),pending=coalesce((p_data->>'pending')::boolean,false) where id;
  return '{"ok":true}';
 elsif p_action='retention_page' then
  foreach t in array tables loop
   rows:=private.monitoring_archive_candidates(t);
   if jsonb_array_length(rows)>0 then
    raw:=jsonb_build_object('table',t,'rows',rows)::text;
    return jsonb_build_object('table',t,'raw',raw,'rows',jsonb_array_length(rows),'sha256',encode(sha256(convert_to(raw,'UTF8')),'hex'));
   end if;
  end loop;
  return '{"rows":0}';
 end if;
 perform pg_advisory_xact_lock(791704);
 select * into object from private.monitoring_archive_objects where path=p_data->>'path' and kind='snapshot' and metadata->>'type'='rolling-retention';
 if object.path is null then raise exception 'ARCHIVE_OBJECT_NOT_STORED';end if;
 if exists(select 1 from private.monitoring_archive_retained where path=object.path) then return '{"ok":true,"replayed":true}';end if;
 raw:=p_data->>'raw';t:=(raw::jsonb)->>'table';rows:=(raw::jsonb)->'rows';expected:=jsonb_array_length(rows);
 if t is null or not t=any(tables) or expected not between 1 and 100 or t is distinct from object.metadata->>'table'
  or encode(sha256(convert_to(raw,'UTF8')),'hex') is distinct from object.expanded_sha256 then raise exception 'ARCHIVE_RESTORE_MISMATCH';end if;
 -- A concurrent correction or reprocessing invalidates the page; no row is removed.
 if private.monitoring_archive_candidates(t) is distinct from rows then return '{"ok":false,"stale":true}';end if;
 if t='public.monitoring_occurrences' then
  delete from public.monitoring_occurrences y using jsonb_populate_recordset(null::public.monitoring_occurrences,rows) x where x.file_id=y.file_id and x.occurrence_key=y.occurrence_key and to_jsonb(x)=to_jsonb(y);
 else
  execute format('delete from %s y using jsonb_populate_recordset(null::%s,$1) x where x.id=y.id and to_jsonb(x)=to_jsonb(y)',t::regclass,t::regclass) using rows;
 end if;
 get diagnostics n=row_count;
 if n<>expected then raise exception 'ARCHIVE_RESTORE_MISMATCH';end if;
 insert into private.monitoring_archive_retained(path,table_name,rows) values(object.path,t,n);
 return jsonb_build_object('ok',true,'rows',n);
end $$;
revoke all on function private.monitoring_archive_worker_before_retention(text,jsonb),private.monitoring_archive_worker_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_archive_worker_impl(text,jsonb) to service_role;

-- Reuse the existing one-use dispatch and scheduler, including when imports are idle.
alter function private.monitoring_cloud_reprocess_due() rename to monitoring_cloud_reprocess_before_retention;
create function private.monitoring_cloud_reprocess_due() returns boolean language sql stable security definer set search_path='' as $$
 select private.monitoring_cloud_reprocess_before_retention() or private.monitoring_archive_retention_due()
$$;
revoke all on function private.monitoring_cloud_reprocess_before_retention(),private.monitoring_cloud_reprocess_due() from public,anon,authenticated,service_role;

-- Stop before the Free database ceiling; already confirmed batches remain intact.
create function private.monitoring_archive_capacity() returns trigger language plpgsql security definer set search_path='' as $$begin
 if (select active from private.monitoring_archive_control where id) and pg_database_size(current_database())>=470*1024*1024 then raise exception 'ARCHIVE_DATABASE_CAPACITY';end if;
 return new;
end $$;
revoke all on function private.monitoring_archive_capacity() from public,anon,authenticated,service_role;
create trigger monitoring_archive_capacity before insert on public.monitoring_events for each statement execute function private.monitoring_archive_capacity();
