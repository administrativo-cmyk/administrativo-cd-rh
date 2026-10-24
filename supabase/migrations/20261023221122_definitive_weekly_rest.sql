-- Definitive weekly rest policy. Existing raw schedules and punch events remain
-- intact. Effective schedule projections apply the policy for every employee.
-- Night profiles require explicit confirmation; never infer sex from a name.
create function private.schedule_weekly_rest_payload(p jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select case when p ? 'cycle' then p-'weeklyRest'
 else (p-'monthlySundayOff'-'monthlySundayOffDates') || jsonb_build_object(
  'weeklyRest',case when (p->>'end'<p->>'start') then
    case when p#>>'{weeklyRest,kind}' in ('night','night-women','night-pending') then p->'weeklyRest' else '{"kind":"night-pending"}'::jsonb end
   else '{"kind":"day"}'::jsonb end,
  'days',case when (p->>'end'<p->>'start') then '[0,1,2,3,4,5]'::jsonb
   else coalesce((select jsonb_agg(x::int order by x::int) from jsonb_array_elements_text(p->'days') x where x<>'0'),'[]'::jsonb) end)
 end
$$;
revoke all on function private.schedule_weekly_rest_payload(jsonb) from public,anon,authenticated,service_role;

create or replace function private.schedule_cycle_payload(p jsonb,d date) returns jsonb language sql immutable set search_path='' as $$
 select case
 when not (p->'days' @> to_jsonb(array[extract(dow from d)::int]))
  or (p ? 'cycle' and abs(d-(p#>>'{cycle,anchorDate}')::date)%2=1)
  or (not (p ? 'cycle') and p#>>'{weeklyRest,kind}'='day' and extract(dow from d)=0)
  or (not (p ? 'cycle') and p#>>'{weeklyRest,kind}' in ('night','night-women','night-pending') and extract(dow from d)=6)
  or (not (p ? 'cycle') and p#>>'{weeklyRest,kind}'='night-women' and extract(dow from d)=0
    and p#>>'{weeklyRest,sundayOffAnchor}' is not null and abs(d-(p#>>'{weeklyRest,sundayOffAnchor}')::date)%14=0)
  then jsonb_set(p,'{days}','[]')
 when not (p ? 'cycle') and extract(dow from d)=0 and
  (p#>>'{weeklyRest,kind}'='night-pending' or (p#>>'{weeklyRest,kind}'='night-women' and p#>>'{weeklyRest,sundayOffAnchor}' is null))
  then jsonb_set(p,'{weeklyRosterConfirmed}','false')
 else p end
$$;

-- Normalize base rows before daily materialization. Existing calendar work/off
-- overrides continue to take precedence over weekly rest.
do $$ declare definition text; signature text; needle text; begin
 foreach signature in array array['private.schedule_window_rows(uuid,date,date)','private.schedule_attribution_rows(uuid,date,date)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:='if row.payload ? ''cycle'' or row.payload->>''monthlySundayOff''=''true'' then';
  if strpos(definition,needle)=0 then raise exception 'WEEKLY_REST_DEFINITION_CHANGED';end if;
  definition:=replace(definition,needle,'if row.valid_from=row.valid_to and private.calendar_resolution(p_employee,row.valid_from)->>''state''=''work'' then row.payload:=row.payload-''weeklyRest''; elsif not (row.payload ? ''weeklyRest'') or row.payload->''days''<>''[]''::jsonb then row.payload:=private.schedule_weekly_rest_payload(row.payload);end if; if row.payload ? ''cycle'' or row.payload#>>''{weeklyRest,kind}'' in (''night-women'',''night-pending'') then');
  definition:=replace(definition,'copy.payload:=copy.payload-''cycle''-''monthlySundayOff''-''monthlySundayOffDates'';','copy.payload:=jsonb_set(copy.payload-''cycle''-''monthlySundayOff''-''monthlySundayOffDates''-''weeklyRest'',''{days}'',to_jsonb(array[extract(dow from day)::int]));');
  execute definition;
 end loop;
 definition:=pg_get_functiondef('private.monitoring_input_before_punch_sources(uuid,date,date)'::regprocedure);
 needle:='and (payload ? ''cycle'' or payload->>''monthlySundayOff''=''true'')';
 if strpos(definition,needle)=0 then raise exception 'WEEKLY_REST_INPUT_CHANGED';end if;
 execute replace(definition,needle,'');
 definition:=pg_get_functiondef('private.employee_schedule_snapshot(uuid,date,boolean)'::regprocedure);
 needle:='''payload'',s.payload';
 if strpos(definition,needle)=0 then raise exception 'WEEKLY_REST_SNAPSHOT_CHANGED';end if;
 execute replace(definition,needle,'''payload'',private.schedule_weekly_rest_payload(s.payload)');
 definition:=pg_get_functiondef('private.employee_schedule_impl(text,jsonb)'::regprocedure);
 needle:='''monthlySundayOffDates''))';
 if strpos(definition,needle)=0 then raise exception 'WEEKLY_REST_SAVE_CHANGED';end if;
 execute replace(definition,needle,'''monthlySundayOffDates'',''weeklyRest''))');
end $$;

alter function private.monitoring_validate_setting(jsonb) rename to monitoring_validate_setting_before_weekly_rest;
create function private.monitoring_validate_setting(p_data jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare p jsonb:=p_data->'payload'; rest jsonb:=p->'weeklyRest';
begin
 perform private.monitoring_validate_setting_before_weekly_rest(p_data);
 if p_data->>'kind'='schedule' and p ? 'weeklyRest' then
  if jsonb_typeof(rest) is distinct from 'object' or coalesce(rest->>'kind','') not in ('day','night','night-women','night-pending')
   or exists(select 1 from jsonb_object_keys(rest) k where k not in ('kind','sundayOffAnchor'))
   or p ? 'cycle' or (rest->>'kind'='day' and (p->>'end'<p->>'start'))
   or (rest->>'kind'<>'day' and not (p->>'end'<p->>'start')) then raise exception 'SETTING_INVALID_INPUT';end if;
  if rest ? 'sundayOffAnchor' then
   if rest->>'kind'<>'night-women' or coalesce(rest->>'sundayOffAnchor','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or not isfinite((rest->>'sundayOffAnchor')::date) or extract(dow from (rest->>'sundayOffAnchor')::date)<>0 then raise exception 'SETTING_INVALID_INPUT';end if;
  end if;
 end if;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'SETTING_INVALID_INPUT';
end $$;
revoke all on function private.monitoring_validate_setting_before_weekly_rest(jsonb),private.monitoring_validate_setting(jsonb) from public,anon,authenticated,service_role;

-- Persist normalized policy on every future default save, using existing
-- permissions, concurrency, history, audit and recalculation queues.
alter function private.employee_schedule_impl(text,jsonb) rename to employee_schedule_impl_before_weekly_rest;
create function private.employee_schedule_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snapshot jsonb;
begin
 if p_action='save' then
  snapshot:=private.employee_schedule_impl_before_weekly_rest('get',p_data);
  if coalesce((snapshot->>'canEdit')::boolean,false)=false then raise exception using errcode='42501',message='SCHEDULE_FORBIDDEN';end if;
  -- Validate the submitted profile before normalization can replace it.
  perform private.monitoring_validate_setting(jsonb_build_object('kind','schedule','target',p_data->>'employeeId','validFrom',p_data->>'validFrom','reason',p_data->>'reason','payload',p_data->'payload'));
  p_data:=jsonb_set(p_data,'{payload}',private.schedule_weekly_rest_payload(p_data->'payload'));
 end if;
 return private.employee_schedule_impl_before_weekly_rest(p_action,p_data);
end $$;
revoke all on function private.employee_schedule_impl_before_weekly_rest(text,jsonb),private.employee_schedule_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.employee_schedule_impl(text,jsonb) to authenticated;

-- Invalidate derived monitoring results without changing manual attendance,
-- corrections, raw events or posted bank movements. Existing leases stay intact.
update private.monitoring_revision set version=version+1 where id=true;
update public.monitoring_results r set dirty=true
where r.active and exists(select 1 from public.monitoring_settings s
 where s.kind='schedule' and s.target=r.employee_id::text and s.revoked_at is null
 and not (s.payload ? 'cycle') and s.valid_from<=r.operational_date and coalesce(s.valid_to,'9999-12-31')>=r.operational_date);
insert into public.monitoring_jobs(employee_id,operational_date,reason)
select distinct r.employee_id,r.operational_date,'Regra definitiva de folgas semanais'
from public.monitoring_results r where r.active and r.dirty and exists(select 1 from public.monitoring_settings s
 where s.kind='schedule' and s.target=r.employee_id::text and s.revoked_at is null
 and not (s.payload ? 'cycle') and s.valid_from<=r.operational_date and coalesce(s.valid_to,'9999-12-31')>=r.operational_date)
on conflict(employee_id,operational_date) do update set reason=excluded.reason;
