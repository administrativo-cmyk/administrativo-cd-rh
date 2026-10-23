-- Payroll options always use today's operational window, not a historical selection.
create or replace function private.daily_call_read_with_periods(p_date date,p_start date,p_end date,p_situation text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; periods jsonb; cutoff date:=private.monitoring_archive_cutoff();
 current_start date:=(cutoff+interval '2 months')::date;
 current_month text:=to_char(current_start+interval '1 month','YYYY-MM');
begin
 result:=private.daily_call_read_impl(p_date,p_start,p_end,p_situation);
 select jsonb_agg(cycle order by cycle desc) into periods from (
  select current_month as cycle
  union
  select to_char(date_trunc('month',cd.data)+case when extract(day from cd.data)>=21 then interval '1 month' else interval '0 months' end,'YYYY-MM')
  from public.chamada_diaria cd
  join jsonb_to_recordset(result->'employees') as employee(id uuid) on employee.id=cd.colaborador_id
  where cd.data>=cutoff and cd.data<(current_start+interval '1 month')::date
 ) available;
 return result||jsonb_build_object('payrollPeriods',periods);
end $$;

-- Reuse the existing immutable cloud copy, reread/hash validation and exact-row
-- commit. Only automatic presences are eligible; G, absences and manual days stay.
alter function private.monitoring_archive_candidates(text) rename to monitoring_archive_candidates_before_attendance;
create function private.monitoring_archive_candidates(p_table text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_table<>'public.chamada_diaria' then return private.monitoring_archive_candidates_before_attendance(p_table);end if;
 return (select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from (
  select c.* from public.chamada_diaria c where c.data<private.monitoring_archive_cutoff()
   and c.status='P' and c.origin='punch' and c.created_by is null and c.updated_by is null
   and not private.monitoring_archive_manual_day(c.colaborador_id,c.data) order by c.id limit 500
 ) q);
end $$;

alter function private.monitoring_archive_page_matches(text,jsonb) rename to monitoring_archive_page_matches_before_attendance;
create function private.monitoring_archive_page_matches(p_table text,p_rows jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if p_table<>'public.chamada_diaria' then return private.monitoring_archive_page_matches_before_attendance(p_table,p_rows);end if;
 return (select count(*)=jsonb_array_length(p_rows)
  from jsonb_populate_recordset(null::public.chamada_diaria,p_rows) x join public.chamada_diaria y using(id)
  where to_jsonb(x)=to_jsonb(y) and y.data<private.monitoring_archive_cutoff()
   and y.status='P' and y.origin='punch' and y.created_by is null and y.updated_by is null
   and not private.monitoring_archive_manual_day(y.colaborador_id,y.data));
end $$;
revoke all on function private.monitoring_archive_candidates(text),private.monitoring_archive_candidates_before_attendance(text),
 private.monitoring_archive_page_matches(text,jsonb),private.monitoring_archive_page_matches_before_attendance(text,jsonb) from public,anon,authenticated,service_role;

do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.monitoring_archive_worker_before_details(text,jsonb)'::regprocedure);
 needle:='''private.daily_call_audit'',''private.daily_call_decisions'']';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_ATTENDANCE_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,'''private.daily_call_audit'',''private.daily_call_decisions'',''public.chamada_diaria'']');
 needle:='foreach t in array tables loop';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_ATTENDANCE_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,'foreach t in array (case when p_data->>''table''=''public.chamada_diaria'' then array[''public.chamada_diaria''] else tables end) loop');
 needle:='if not private.monitoring_archive_page_matches(t,rows) then';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_ATTENDANCE_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,$patch$
 if t='public.chamada_diaria' then
  perform pg_advisory_xact_lock(hashtext(x.employee_id::text),hashtext(x.operational_date::text))
   from (select distinct (v->>'colaborador_id')::uuid employee_id,(v->>'data')::date operational_date from jsonb_array_elements(rows) v) x order by x.employee_id,x.operational_date;
 end if;
 if not private.monitoring_archive_page_matches(t,rows) then
 $patch$);
 execute definition;
end $$;
update private.monitoring_archive_retention set pending=true,checked_at='-infinity' where id;
