do $$begin
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(791704);
 if exists(select 1 from private.monitoring_cloud_jobs where status in('uploading','queued','processing')) then
  raise exception 'IMPORT_INVALIDATION_IMPORTS_ACTIVE';
 end if;
end $$;

-- A normal successful import only advances readiness for windows ending since
-- the previous success. New/changed punches already invalidate their own dates.
-- Keep full invalidation for initial readiness, configuration changes, errors,
-- recovery and a regressing/removed success watermark.
create or replace function private.daily_call_source_ready() returns trigger
language plpgsql security definer set search_path='' as $$
declare first_day date;last_day date;error_changed boolean;
begin
 error_changed:=coalesce(new.worker_state='error',false) is distinct from coalesce(old.worker_state='error',false);
 if new.kind<>'afd' or not(new.last_success_at is distinct from old.last_success_at
  or new.configuration is distinct from old.configuration or error_changed) then return new;end if;
 if error_changed then update private.monitoring_revision set version=version+1 where id=true;end if;
 if old.last_success_at is not null and new.last_success_at>old.last_success_at
  and new.configuration is not distinct from old.configuration and not error_changed then
  -- Neighboring days preserve overnight windows and the existing +/-1 rule.
  first_day:=(old.last_success_at at time zone 'America/Sao_Paulo')::date-1;
  last_day:=(new.last_success_at at time zone 'America/Sao_Paulo')::date+1;
 end if;
 update public.monitoring_results r set dirty=true
 where active and not dirty and operational_date between coalesce(first_day,'0001-01-01') and coalesce(last_day,'9999-12-31')
  and exists(select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
   where b.employee_id=r.employee_id and bs.identity_namespace=new.identity_namespace);
 perform private.monitoring_enqueue(null,first_day,last_day,new.id);
 return new;
end $$;
revoke all on function private.daily_call_source_ready() from public,anon,authenticated,service_role;

-- Avoid rewriting already dirty results and unleased jobs with identical
-- reasons. An in-flight calculation must still lose its lease on invalidation.
-- Date bounds on the timestamp also avoid scanning a clock's full event history.
do $$
declare definition text;signature text;needle text;replacement text;expected integer;actual integer;
begin
 for signature,expected in select * from(values
  ('private.monitoring_ingest_before_source_management(jsonb)',2),
  ('private.monitoring_enqueue_before_attendance(uuid,date,date,text)',2),
  ('private.monitoring_enqueue_before_archive(uuid,date,date,text)',1)
 ) patches(signature,expected) loop
  definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  needle:='on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;';
  actual:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
  if actual<>expected then raise exception 'IMPORT_INVALIDATION_DEFINITION_CHANGED: %',signature;end if;
  replacement:=left(needle,length(needle)-1)||' where monitoring_jobs.reason is distinct from excluded.reason or monitoring_jobs.leased_until is not null or monitoring_jobs.lease_token is not null;';
  definition:=replace(definition,needle,replacement);
  if signature='private.monitoring_ingest_before_source_management(jsonb)' then
   needle:='update public.monitoring_results r set dirty=true where active and exists(';
   actual:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
   if actual<>2 then raise exception 'IMPORT_DIRTY_DEFINITION_CHANGED';end if;
   definition:=replace(definition,needle,'update public.monitoring_results r set dirty=true where active and not dirty and exists(');
  elsif signature='private.monitoring_enqueue_before_attendance(uuid,date,date,text)' then
   needle:='where b.revoked_at is null and (p_employee is null or b.employee_id=p_employee)';
   if strpos(definition,needle)=0 then raise exception 'IMPORT_ENQUEUE_BOUNDS_CHANGED';end if;
   definition:=replace(definition,needle,needle||$bounds$
 and (p_start is null or e.occurred_at>=((p_start-1)::timestamp at time zone 'America/Sao_Paulo'))
 and (p_end is null or e.occurred_at<((p_end+2)::timestamp at time zone 'America/Sao_Paulo'))$bounds$);
  end if;
  execute definition;
 end loop;
end $$;
