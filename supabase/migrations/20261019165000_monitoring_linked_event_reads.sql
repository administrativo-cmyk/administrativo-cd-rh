-- Bound the event lookup by the employee's validated identities before building
-- provenance or attendance evidence. Preserve all namespace and validity rules.
create function private.monitoring_linked_events(p_employee uuid,p_start timestamptz,p_end timestamptz,p_timezone text default 'America/Sao_Paulo')
returns setof public.monitoring_events language sql stable security definer set search_path='' as $$
 select distinct on(e.id) e.* from public.monitoring_bindings b
 join public.monitoring_sources bs on bs.id=b.source_id
 join public.monitoring_sources s on s.identity_namespace=bs.identity_namespace
 join public.monitoring_events e on e.source_id=s.id and e.identity_type=b.identity_type and e.identity_value=b.identity_value
  and e.occurred_at>=p_start and e.occurred_at<p_end
 where b.employee_id=p_employee and b.revoked_at is null
 and (e.occurred_at at time zone coalesce(p_timezone,s.timezone))::date between b.valid_from and coalesce(b.valid_to,'9999-12-31')
 order by e.id
$$;
revoke all on function private.monitoring_linked_events(uuid,timestamptz,timestamptz,text) from public,anon,authenticated,service_role;

do $patch$
declare definition text;needle text;item record;matches integer:=0;
begin
 definition:=pg_get_functiondef('private.monitoring_input_before_calendar(uuid,date,date)'::regprocedure);
 needle:='from public.monitoring_events e';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'MONITORING_INPUT_LOOKUP_CHANGED';end if;
 execute replace(definition,needle,'from private.monitoring_linked_events(employee,(start_date-1)::timestamp at time zone ''America/Sao_Paulo'',(end_date+2)::timestamp at time zone ''America/Sao_Paulo'',''America/Sao_Paulo'') e');
 for item in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'daily_call_evidence%' loop
  definition:=pg_get_functiondef(item.oid);
  needle:='from public.monitoring_events e join public.monitoring_sources s on s.id=e.source_id';
  if strpos(definition,needle)=0 then continue;end if;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'DAILY_EVIDENCE_LOOKUP_CHANGED';end if;
  matches:=matches+1;
  execute replace(definition,needle,'from private.monitoring_linked_events(p_employee,v_window_start,v_window_end,null) e join public.monitoring_sources s on s.id=e.source_id');
 end loop;
 if matches<>1 then raise exception 'DAILY_EVIDENCE_LOOKUP_CHANGED: %',matches;end if;
end $patch$;
