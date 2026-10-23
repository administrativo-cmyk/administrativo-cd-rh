-- Derive available payroll cycles from persisted attendance in the same read scope.
create function private.daily_call_read_with_periods(p_date date,p_start date,p_end date,p_situation text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; periods jsonb;
begin
 -- The existing reader validates the session, role, period and employee scope.
 result := private.daily_call_read_impl(p_date,p_start,p_end,p_situation);
 select coalesce(jsonb_agg(cycle order by cycle desc),'[]'::jsonb) into periods
 from (
   select distinct to_char(date_trunc('month',cd.data)
     + case when extract(day from cd.data)>=21 then interval '1 month' else interval '0 months' end,'YYYY-MM') as cycle
   from public.chamada_diaria cd
   join jsonb_to_recordset(result->'employees') as employee(id uuid) on employee.id=cd.colaborador_id
 ) available;
 return result || jsonb_build_object('payrollPeriods',periods);
end $$;

revoke all on function private.daily_call_read_with_periods(date,date,date,text) from public,anon,authenticated,service_role;
grant execute on function private.daily_call_read_with_periods(date,date,date,text) to authenticated;

create or replace function public.daily_call_read(p_date date,p_start date,p_end date,p_situation text default null) returns jsonb
language sql security invoker set search_path='' as $$
 select private.daily_call_read_with_periods(p_date,p_start,p_end,p_situation)
$$;
