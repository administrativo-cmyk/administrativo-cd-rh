-- Fixed roster days appear immediately in the existing authorized read. They
-- remain derived from the effective schedule instead of becoming stale manual
-- attendance or a bank-hours movement.
create function private.daily_call_fixed_rest_records(p_employee uuid,p_start date,p_end date,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare day date; proof jsonb; records jsonb:='[]';
begin
 for day in
  with dates as (
   select d::date as day from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d
   union select p_date
  ), schedules as materialized (
   select * from private.schedule_window_rows(p_employee,p_start,p_end)
   union all
   select * from private.schedule_window_rows(p_employee,p_date,p_date) where p_date not between p_start and p_end
  )
  select d.day from dates d join schedules s on s.valid_from<=d.day and coalesce(s.valid_to,'9999-12-31')>=d.day
  where private.employee_attendance_allowed(p_employee,d.day)
   and d.day>=private.monitoring_archive_cutoff()
   and exists(select 1 from public.colaboradores c where c.id=p_employee and c.admissao is not null)
   and not private.employee_absence_protected(p_employee,d.day)
   and not exists(select 1 from public.ferias_planejamento v where v.colaborador_id=p_employee and v.archived_at is null and v.status='approved' and d.day between v.inicio and v.fim)
   and not exists(select 1 from public.chamada_diaria c where c.colaborador_id=p_employee and c.data=d.day)
   and not private.monitoring_archive_manual_day(p_employee,d.day)
  group by d.day
  having count(*)=1
   and bool_and(s.payload->>'estimated' is distinct from 'true' and s.payload->>'weeklyRosterConfirmed' is distinct from 'false')
   and bool_and(not (s.payload->'days' @> to_jsonb(array[extract(dow from d.day)::integer])))
  order by d.day
 loop
  -- This reuses the existing overnight attribution and linked punch/correction
  -- checks. Collection completeness is not needed to show a confirmed roster.
  if day<=(now() at time zone 'America/Sao_Paulo')::date then
   proof:=private.daily_call_evidence(p_employee,day);
   if proof->>'status'='P' or coalesce(jsonb_array_length(proof->'punchIds'),0)>0 then continue;end if;
  end if;
  records:=records||jsonb_build_array(jsonb_build_object('date',day,'status','F','origin','schedule','observation','Folga fixa da escala'));
 end loop;
 return records;
end $$;
revoke all on function private.daily_call_fixed_rest_records(uuid,date,date,date) from public,anon,authenticated,service_role;

-- Keep the existing session validation, read/write scope, aliases, lifecycle,
-- persisted record versions and financial snapshot in the same reader.
do $migration$
declare definition text; needle text:=$old$'attendance',coalesce(ch.records,'[]'::jsonb)$old$;
begin
 definition:=pg_get_functiondef('private.daily_call_read_impl(date,date,date,text)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'FIXED_REST_READ_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,needle||'||private.daily_call_fixed_rest_records(c.id,p_start,p_end,p_date)');
end $migration$;
