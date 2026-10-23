-- The same conservative manual-day set, evaluated once per page. Thousands of
-- per-row security-definer calls exceeded the REST role's statement budget.
create function private.monitoring_archive_manual_days() returns table(employee_id uuid,operational_date date)
language sql stable security definer set search_path='' as $$
 select employee_id,operational_date from private.daily_call_decisions where manual_override
 union select colaborador_id,data from public.chamada_diaria where origin='manual' or created_by is not null or updated_by is not null
 union select employee_id,operational_date from private.daily_call_audit where employee_id is not null and operational_date is not null and (actor is not null or action not in ('DECISION','IMPORT'))
 union select colaborador_id,data from public.chamada_diaria_auditoria where operacao='CLEAR'
 union select employee_id,operational_date from private.attendance_punch_corrections
$$;
revoke all on function private.monitoring_archive_manual_days() from public,anon,authenticated,service_role;
do $$declare definition text;needle text;branch text;begin
 definition:=pg_get_functiondef('private.monitoring_archive_candidates(text)'::regprocedure);
 foreach branch in array array['if p_table=''private.daily_call_decisions'' then','elsif p_table=''private.daily_call_audit'' then'] loop
  if strpos(definition,branch)=0 then raise exception 'ARCHIVE_MANUAL_SET_PATCH_CHANGED';end if;
  definition:=replace(definition,branch,branch||chr(10)||'with protected_days as materialized(select * from private.monitoring_archive_manual_days())');
 end loop;
 needle:='and not private.monitoring_archive_manual_day(employee_id,operational_date) order by employee_id,operational_date';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_MANUAL_SET_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,'and not exists(select 1 from protected_days m where m.employee_id=d.employee_id and m.operational_date=d.operational_date) order by employee_id,operational_date');
 needle:='and not private.monitoring_archive_manual_day(employee_id,operational_date) order by id';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_MANUAL_SET_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,'and not exists(select 1 from protected_days m where m.employee_id=a.employee_id and m.operational_date=a.operational_date) order by id');execute definition;
 definition:=pg_get_functiondef('private.monitoring_archive_page_matches(text,jsonb)'::regprocedure);
 foreach branch in array array['if p_table=''private.daily_call_decisions'' then','elsif p_table=''private.daily_call_audit'' then'] loop
  if strpos(definition,branch)=0 then raise exception 'ARCHIVE_MANUAL_SET_PATCH_CHANGED';end if;
  definition:=replace(definition,branch,branch||chr(10)||'with protected_days as materialized(select * from private.monitoring_archive_manual_days())');
 end loop;
 needle:='not private.monitoring_archive_manual_day(y.employee_id,y.operational_date)';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_MANUAL_SET_PATCH_CHANGED';end if;
 execute replace(definition,needle,'not exists(select 1 from protected_days m where m.employee_id=y.employee_id and m.operational_date=y.operational_date)');
end $$;
