-- Employee defaults: explicit scope checks, optimistic concurrency, preserved history.
create function private.employee_schedule_snapshot(p_employee uuid,p_date date,p_edit boolean) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('employeeId',c.id,'canEdit',p_edit,
 'version',md5(c.updated_at::text||coalesce(c.gestor_id::text,'')||coalesce((select string_agg(s.id::text||s.updated_at::text,'|' order by s.id) from public.monitoring_settings s where s.kind='schedule' and s.target=c.id::text and s.revoked_at is null),'')),
 'setting',(select jsonb_build_object('id',s.id,'validFrom',s.valid_from,'validTo',s.valid_to,'updatedAt',s.updated_at,'payload',s.payload) from public.monitoring_settings s where s.kind='schedule' and s.target=c.id::text and s.revoked_at is null and s.valid_from<=p_date and coalesce(s.valid_to,'9999-12-31')>=p_date limit 1))
 from public.colaboradores c where c.id=p_employee
$$;
revoke all on function private.employee_schedule_snapshot(uuid,date,boolean) from public,anon,authenticated,service_role;

create function private.employee_schedule_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); profile public.perfis; employee public.colaboradores; old public.monitoring_settings; fresh public.monitoring_settings;
 v_employee_id uuid:=(p_data->>'employeeId')::uuid; day date:=(p_data->>'date')::date; start_date date:=(p_data->>'validFrom')::date;
 payload jsonb:=p_data->'payload'; reason text:=btrim(p_data->>'reason'); snapshot jsonb; previous jsonb; can_edit boolean;
begin
 if p_action is null or p_action not in ('get','save') or jsonb_typeof(p_data) is distinct from 'object' or day is null or not isfinite(day) then raise exception 'SCHEDULE_INVALID';end if;
 if p_action='save' then perform pg_advisory_xact_lock(824202609,1);perform pg_advisory_xact_lock(791800,1);perform pg_advisory_xact_lock(791702);end if;
 select * into profile from public.perfis where id=actor and status_usuario='APROVADO' for share;
 if profile.papel_usuario is null then raise exception using errcode='42501',message='SCHEDULE_FORBIDDEN';end if;
 select * into employee from public.colaboradores where id=v_employee_id and ativo_no_sistema for share;
 if employee.id is null or (profile.papel_usuario='GESTOR' and (profile.gestor_id is null or employee.gestor_id is distinct from profile.gestor_id)) then raise exception using errcode='42501',message='SCHEDULE_FORBIDDEN';end if;
 can_edit:=profile.papel_usuario in ('ADMIN','RH','GESTOR');
 snapshot:=private.employee_schedule_snapshot(v_employee_id,day,can_edit);
 if p_action='get' then return snapshot;end if;
 if not can_edit then raise exception using errcode='42501',message='SCHEDULE_FORBIDDEN';end if;
 if p_data->>'expectedVersion' is distinct from snapshot->>'version' then raise exception 'SCHEDULE_STALE';end if;
 if start_date is null or not isfinite(start_date) or start_date<coalesce(employee.admissao,start_date) or length(coalesce(reason,'')) not between 5 and 1000
 or jsonb_typeof(payload) is distinct from 'object' or payload->>'lunchMinutes' is distinct from '60' or payload->>'allowNoBreak' is distinct from 'false'
 or payload->>'pairing' is distinct from 'alternating' or payload->'coffeeWindows' is distinct from '[]'::jsonb
 or jsonb_typeof(payload->'weeklyRosterConfirmed') is distinct from 'boolean' or jsonb_typeof(payload->'estimated') is distinct from 'boolean'
 or (payload->>'estimated'='true' and payload->>'weeklyRosterConfirmed'<>'false')
 or exists(select 1 from jsonb_object_keys(payload) k where k not in ('name','start','end','days','lunchMinutes','allowNoBreak','pairing','coffeeWindows','weeklyRosterConfirmed','estimated','cycle','monthlySundayOff','monthlySundayOffDates')) then raise exception 'SCHEDULE_INVALID';end if;
 perform private.monitoring_validate_setting(jsonb_build_object('kind','schedule','target',v_employee_id,'validFrom',start_date,'validTo',null,'reason',reason,'payload',payload));
 if ((extract(epoch from ((payload->>'end')::time-(payload->>'start')::time))/60+1440)::int%1440)<=60 then raise exception 'SCHEDULE_INVALID';end if;
 if payload ? 'cycle' then
  if jsonb_typeof(payload->'cycle') is distinct from 'object' or payload#>>'{cycle,kind}' is distinct from '12x36' or payload->>'weeklyRosterConfirmed'<>'true'
  or payload#>>'{cycle,anchorDate}'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or not isfinite((payload#>>'{cycle,anchorDate}')::date)
  or exists(select 1 from jsonb_object_keys(payload->'cycle') k where k not in ('kind','anchorDate')) then raise exception 'SCHEDULE_INVALID';end if;
 end if;
 -- A single open default can be split at the effective date. Future overrides require review.
 if (select count(*) from public.monitoring_settings where kind='schedule' and target=v_employee_id::text and revoked_at is null and coalesce(valid_to,'9999-12-31')>=start_date)>1 then raise exception 'SCHEDULE_CONFLICT';end if;
 select * into old from public.monitoring_settings where kind='schedule' and target=v_employee_id::text and revoked_at is null and coalesce(valid_to,'9999-12-31')>=start_date;
 if old.id is not null and (old.valid_to is not null or old.valid_from>start_date or exists(select 1 from public.monitoring_settings where supersedes_id=old.id)) then raise exception 'SCHEDULE_CONFLICT';end if;
 previous:=case when old.id is null then null else to_jsonb(old) end;
 perform private.monitoring_prepare_setting_change(v_employee_id,start_date,null);
 perform 1 from private.monitoring_revision where id=true for update;
 if old.id is not null then
  if old.valid_from<start_date then update public.monitoring_settings set valid_to=start_date-1 where id=old.id;
  else update public.monitoring_settings set revoked_at=clock_timestamp() where id=old.id;end if;
 end if;
 insert into public.monitoring_settings(kind,target,valid_from,valid_to,payload,reason,created_by,revision,supersedes_id)
 values('schedule',v_employee_id::text,start_date,null,payload,reason,actor,coalesce(old.revision,0)+1,old.id) returning * into fresh;
 update private.monitoring_revision set version=version+1 where id=true;
 update public.monitoring_results set dirty=true where active and employee_id=employee.id and operational_date>=start_date;
 perform private.monitoring_enqueue(employee.id,start_date,null);
 insert into public.monitoring_audit(actor,action,target,detail) values(actor,'employee_default_schedule',fresh.id::text,jsonb_build_object('employeeId',employee.id,'reason',reason,'before',previous,'after',to_jsonb(fresh)));
 if profile.papel_usuario='GESTOR' then
  insert into private.workspace_notices(title,body,audience_role,created_by)
  select 'Horário padrão alterado pelo encarregado',employee.nome||' · matrícula '||employee.matricula||E'\n'||profile.nome_completo||' alterou o horário: '||coalesce(old.payload->>'start','sem cadastro')||'–'||coalesce(old.payload->>'end','')||' → '||(payload->>'start')||'–'||(payload->>'end')||'. Almoço: 1h. Vigência: '||to_char(start_date,'DD/MM/YYYY')||E'.\nMotivo: '||reason,role_name,actor
  from unnest(array['ADMIN','RH']::public.papel_usuario[]) role_name;
 end if;
 return private.employee_schedule_snapshot(employee.id,greatest(day,start_date),can_edit);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'SCHEDULE_INVALID';
end $$;
revoke all on function private.employee_schedule_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.employee_schedule_impl(text,jsonb) to authenticated;
create function public.employee_schedule(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.employee_schedule_impl(p_action,p_data)$$;
revoke all on function public.employee_schedule(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.employee_schedule(text,jsonb) to authenticated;

-- Materialize 12x36 on each operational date. A confirmed calendar exception wins.
create function private.schedule_cycle_payload(p jsonb,d date) returns jsonb language sql immutable set search_path='' as $$
 select case
 when (p#>>'{cycle,kind}'='12x36' and abs(d-(p#>>'{cycle,anchorDate}')::date)%2=1)
 or (p->>'monthlySundayOff'='true' and coalesce(p->'monthlySundayOffDates','[]') @> to_jsonb(array[d::text])) then jsonb_set(p,'{days}','[]')
 when p->>'monthlySundayOff'='true' and extract(dow from d)=0 and not exists(select 1 from jsonb_array_elements_text(coalesce(p->'monthlySundayOffDates','[]')) x where left(x,7)=to_char(d,'YYYY-MM')) then jsonb_set(p,'{weeklyRosterConfirmed}','false')
 else p end
$$;
revoke all on function private.schedule_cycle_payload(jsonb,date) from public,anon,authenticated,service_role;
alter function private.schedule_window_rows(uuid,date,date) rename to schedule_window_rows_before_cycle;
create function private.schedule_window_rows(p_employee uuid,p_start date,p_end date) returns setof public.monitoring_settings
language plpgsql stable security definer set search_path='' as $$
declare row public.monitoring_settings; day date; copy public.monitoring_settings;
begin
 for row in select * from private.schedule_window_rows_before_cycle(p_employee,p_start,p_end) loop
  if row.payload ? 'cycle' or row.payload->>'monthlySundayOff'='true' then
   for day in select d::date from generate_series(greatest(row.valid_from,p_start)::timestamp,least(coalesce(row.valid_to,p_end),p_end)::timestamp,interval '1 day') d loop
    copy:=row;copy.valid_from:=day;copy.valid_to:=day;
    if private.calendar_resolution(p_employee,day)->>'state'<>'work' then copy.payload:=private.schedule_cycle_payload(row.payload,day);else copy.payload:=copy.payload-'cycle'-'monthlySundayOff'-'monthlySundayOffDates';end if;
    return next copy;
   end loop;
  else return next row;end if;
 end loop;
end $$;
alter function private.schedule_attribution_rows(uuid,date,date) rename to schedule_attribution_rows_before_cycle;
create function private.schedule_attribution_rows(p_employee uuid,p_start date,p_end date) returns setof public.monitoring_settings
language plpgsql stable security definer set search_path='' as $$
declare row public.monitoring_settings; day date; copy public.monitoring_settings;
begin
 for row in select * from private.schedule_attribution_rows_before_cycle(p_employee,p_start,p_end) loop
  if row.payload ? 'cycle' or row.payload->>'monthlySundayOff'='true' then
   for day in select d::date from generate_series(greatest(row.valid_from,p_start)::timestamp,least(coalesce(row.valid_to,p_end),p_end)::timestamp,interval '1 day') d loop
    copy:=row;copy.valid_from:=day;copy.valid_to:=day;
    if private.calendar_resolution(p_employee,day)->>'state'<>'work' then copy.payload:=private.schedule_cycle_payload(row.payload,day);else copy.payload:=copy.payload-'cycle'-'monthlySundayOff'-'monthlySundayOffDates';end if;
    return next copy;
   end loop;
  else return next row;end if;
 end loop;
end $$;
-- Cycles need effective per-day payloads even without a holiday calendar.
do $$ declare definition text; needle text:='if not exists(select 1 from jsonb_array_elements(calendar) x where x->>''state''<>''unchanged'') then';begin
 definition:=pg_get_functiondef('private.monitoring_input(uuid,date,date)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'CYCLE_INPUT_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,'if not exists(select 1 from jsonb_array_elements(calendar) x where x->>''state''<>''unchanged'') and not exists(select 1 from public.monitoring_settings where kind=''schedule'' and target=employee::text and revoked_at is null and (payload ? ''cycle'' or payload->>''monthlySundayOff''=''true'')) then');
end $$;
revoke all on function private.schedule_window_rows_before_cycle(uuid,date,date),private.schedule_window_rows(uuid,date,date),private.schedule_attribution_rows_before_cycle(uuid,date,date),private.schedule_attribution_rows(uuid,date,date) from public,anon,authenticated,service_role;

-- Validate new optional fields on the older configuration routes too.
alter function private.monitoring_validate_setting(jsonb) rename to monitoring_validate_setting_before_defaults;
create function private.monitoring_validate_setting(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare p jsonb:=p_data->'payload';
begin
 perform private.monitoring_validate_setting_before_defaults(p_data);
 if p_data->>'kind'='schedule' then
  if (p ? 'lunchMinutes' and p->>'lunchMinutes' is distinct from '60')
  or (p ? 'estimated' and jsonb_typeof(p->'estimated') is distinct from 'boolean')
  or (p ? 'weeklyRosterConfirmed' and jsonb_typeof(p->'weeklyRosterConfirmed') is distinct from 'boolean')
  or (p->>'estimated'='true' and p->>'weeklyRosterConfirmed' is distinct from 'false') then raise exception 'SETTING_INVALID_INPUT';end if;
  if (p ? 'monthlySundayOff' and jsonb_typeof(p->'monthlySundayOff') is distinct from 'boolean') or (p ? 'monthlySundayOffDates' and jsonb_typeof(p->'monthlySundayOffDates') is distinct from 'array') then raise exception 'SETTING_INVALID_INPUT';end if;
  if p ? 'monthlySundayOffDates' then
   if jsonb_array_length(p->'monthlySundayOffDates')>120 then raise exception 'SETTING_INVALID_INPUT';end if;
   if exists(select 1 from jsonb_array_elements_text(p->'monthlySundayOffDates') x where x!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or extract(dow from x::date)<>0) or exists(select 1 from jsonb_array_elements_text(p->'monthlySundayOffDates') x group by left(x,7) having count(*)>1) then raise exception 'SETTING_INVALID_INPUT';end if;
  end if;
  if p ? 'cycle' then
   if p#>>'{cycle,kind}' is distinct from '12x36' or p->>'weeklyRosterConfirmed' is distinct from 'true'
   or coalesce(p#>>'{cycle,anchorDate}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or not isfinite((p#>>'{cycle,anchorDate}')::date) then raise exception 'SETTING_INVALID_INPUT';end if;
  end if;
 end if;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'SETTING_INVALID_INPUT';
end $$;
revoke all on function private.monitoring_validate_setting_before_defaults(jsonb),private.monitoring_validate_setting(jsonb) from public,anon,authenticated,service_role;

alter function private.monitoring_input(uuid,date,date) rename to monitoring_input_before_punch_sources;
create function private.monitoring_input(employee uuid,start_date date,end_date date) returns jsonb language sql stable security definer set search_path='' as $$
 select private.monitoring_input_before_punch_sources(employee,start_date,end_date)||jsonb_build_object('punchSourceIds',coalesce((
 select jsonb_agg(distinct s.id) from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
 join public.monitoring_sources s on s.identity_namespace=bs.identity_namespace and s.kind='afd' and s.active
 where b.employee_id=employee and b.revoked_at is null and b.valid_from<=end_date+1 and coalesce(b.valid_to,'9999-12-31')>=start_date-1),'[]'::jsonb))
$$;
revoke all on function private.monitoring_input_before_punch_sources(uuid,date,date),private.monitoring_input(uuid,date,date) from public,anon,authenticated,service_role;
