create table private.planning_configurations (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('template','calendar','vacation_policy')),
 name text not null check(length(btrim(name)) between 1 and 200), scope text not null check(scope in ('global','unit','manager','person')),
 target uuid, member_ids uuid[] not null default '{}', valid_from date not null, valid_to date,
 payload jsonb not null, active boolean not null default true, created_by uuid not null references public.perfis(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check(isfinite(valid_from) and (valid_to is null or (isfinite(valid_to) and valid_to>=valid_from))),
 check((scope='global')=(target is null))
);
create index planning_configurations_actor on private.planning_configurations(created_by);
create index planning_configurations_dates on private.planning_configurations(kind,valid_from,valid_to) where active;
create trigger planning_configuration_touch before update on private.planning_configurations for each row execute function private.administration_touch();
alter table private.planning_configurations enable row level security;
revoke all on private.planning_configurations from public,anon,authenticated,service_role;

create function private.planning_row(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'kind',kind,'name',name,'scope',scope,'target',target,'memberCount',cardinality(member_ids),
  'validFrom',valid_from,'validTo',valid_to,'payload',payload,'active',active,'createdAt',created_at,'updatedAt',updated_at)
 from private.planning_configurations where id=p_id
$$;
create function private.planning_roster_version() returns text language sql stable security definer set search_path='' as $$
 select md5(coalesce(string_agg(concat_ws('|',id,updated_at,gestor_id,unidade_id,ativo_no_sistema),'~' order by id),'')) from public.colaboradores
$$;
create function private.calendar_resolution(p_employee uuid,p_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare selected private.planning_configurations;
begin
 select * into selected from private.planning_configurations where active and kind='calendar' and valid_from<=p_date and (valid_to is null or valid_to>=p_date)
 and (scope='global' or p_employee=any(member_ids))
 order by case scope when 'person' then 4 when 'manager' then 3 when 'unit' then 2 else 1 end desc,updated_at desc,id limit 1;
 if not found then return jsonb_build_object('state','unchanged','date',p_date); end if;
 return jsonb_build_object('state',case when (selected.payload->>'working')::boolean then 'work' else 'off' end,'date',p_date,'id',selected.id,'name',selected.name,'validFrom',selected.valid_from,'validTo',selected.valid_to,'payload',selected.payload,'createdBy',selected.created_by,'createdAt',selected.created_at);
end $$;

create function private.vacation_suggestions(p_data jsonb,p_role public.papel_usuario,p_manager uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare employee public.colaboradores; policy private.planning_configurations; start_date date; end_date date; candidate date; finish date; day date;
 duration integer; total integer; absent integer; peak integer; valid boolean; suggestions jsonb:='[]'; blockers jsonb:='[]'; version text; reservations text; roster text;
begin
 select * into employee from public.colaboradores where id=(p_data->>'employeeId')::uuid;
 if not found or (p_role='GESTOR' and (p_manager is null or employee.gestor_id is distinct from p_manager)) then raise exception using errcode='42501',message='PLANNING_FORBIDDEN';end if;
 select * into policy from private.planning_configurations where id=(p_data->>'policyId')::uuid and kind='vacation_policy' and active;
 if not found or not(policy.scope='global' or (policy.scope='manager' and policy.target=employee.gestor_id) or (policy.scope='unit' and policy.target=employee.unidade_id)) then raise exception 'PLANNING_POLICY_UNAVAILABLE';end if;
 start_date:=(p_data->>'start')::date;end_date:=(p_data->>'end')::date;
 if start_date is null or end_date is null or not isfinite(start_date) or not isfinite(end_date) or end_date<start_date or end_date-start_date>89 then raise exception 'PLANNING_INVALID_INPUT';end if;
 duration:=(policy.payload->>'durationDays')::integer;
 select count(*),coalesce(string_agg(concat_ws('|',id,updated_at,situacao),'~' order by id),'') into total,roster from public.colaboradores where ativo_no_sistema and gestor_id=employee.gestor_id and situacao in ('ATIVO','NOVO_ADMITIDO','FERIAS');
 select coalesce(string_agg(to_jsonb(f)::text,'~' order by f.id),'') into reservations from public.ferias_planejamento f join public.colaboradores c on c.id=f.colaborador_id where c.gestor_id=employee.gestor_id;
 version:=md5(concat_ws('|',to_jsonb(employee),to_jsonb(policy),roster,reservations,start_date,end_date,(now() at time zone 'America/Sao_Paulo')::date));
 if not employee.ativo_no_sistema or employee.situacao not in ('ATIVO','NOVO_ADMITIDO','FERIAS') then blockers:=blockers||'"EMPLOYEE_NOT_ELIGIBLE"'::jsonb;end if;
 if employee.admissao is null then blockers:=blockers||'"ADMISSION_UNKNOWN"'::jsonb;end if;
 if employee.gestor_id is null or total=0 then blockers:=blockers||'"TEAM_UNKNOWN"'::jsonb;end if;
 if jsonb_array_length(blockers)=0 then
  for candidate in select d::date from generate_series(start_date::timestamp,end_date::timestamp,interval '1 day') d loop
   finish:=candidate+duration-1;peak:=0;valid:=true;
   if finish>end_date or candidate<policy.valid_from or (policy.valid_to is not null and finish>policy.valid_to)
    or candidate<(now() at time zone 'America/Sao_Paulo')::date+(policy.payload->>'noticeDays')::integer
    or candidate<employee.admissao+(policy.payload->>'minimumTenureDays')::integer then continue;end if;
   if exists(select 1 from public.ferias_planejamento where colaborador_id=employee.id and archived_at is null and status<>'cancelled' and inicio<=finish and fim>=candidate) then continue;end if;
   for day in select d::date from generate_series(candidate::timestamp,finish::timestamp,interval '1 day') d loop
    select count(distinct f.colaborador_id)+1 into absent from public.ferias_planejamento f join public.colaboradores c on c.id=f.colaborador_id
     where c.ativo_no_sistema and c.situacao in ('ATIVO','NOVO_ADMITIDO','FERIAS') and c.gestor_id=employee.gestor_id and f.archived_at is null and f.inicio<=day and f.fim>=day
      and (f.status='approved' or (f.status='requested' and (policy.payload->>'includeRequested')::boolean));
    peak:=greatest(peak,absent);
    if absent::numeric*100/total>(policy.payload->>'maximumAbsentPercent')::numeric or total-absent<(policy.payload->>'minimumAvailable')::integer then valid:=false;exit;end if;
   end loop;
   if valid then suggestions:=suggestions||jsonb_build_array(jsonb_build_object('startDate',candidate,'endDate',finish,'teamSize',total,'peakPlannedAbsent',peak,'minimumOutsidePlannedVacation',total-peak));end if;
   exit when jsonb_array_length(suggestions)>=20;
  end loop;
 end if;
 if jsonb_array_length(suggestions)=0 and jsonb_array_length(blockers)=0 then blockers:=jsonb_build_array('NO_WINDOW_MATCHES_POLICY');end if;
 return jsonb_build_object('version',version,'suggestions',suggestions,'blockers',blockers,'policy',private.planning_row(policy.id),'teamSize',total,
  'notes',jsonb_build_array('Critérios internos configurados pelo RH; não comprovam direito adquirido ou saldo legal de férias.','Capacidade usa pessoas do quadro operacional atual da equipe e férias planejadas. Não estima turnos, afastamentos futuros ou disponibilidade real.','Aceitar cria apenas um rascunho. Aprovação e lançamento na Chamada continuam manuais.'));
end $$;
create function private.schedule_window_rows(p_employee uuid,p_start date,p_end date) returns setof public.monitoring_settings
language plpgsql stable security definer set search_path='' as $$
declare day date; resolution jsonb; row public.monitoring_settings;
begin
 if p_end-p_start>368 then raise exception 'PLANNING_PERIOD_TOO_LARGE'; end if;
 if not exists(select 1 from private.planning_configurations where active and kind='calendar' and valid_from<=p_end and valid_to>=p_start and (scope='global' or p_employee=any(member_ids))) then
  return query select * from public.monitoring_settings where kind='schedule' and target=p_employee::text and revoked_at is null and valid_from<=p_end and (valid_to is null or valid_to>=p_start);return;
 end if;
 for day in select d::date from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d loop
  resolution:=private.calendar_resolution(p_employee,day);
  if resolution->>'state'='work' then
   row:=null; row.id:=(resolution->>'id')::uuid; row.kind:='schedule';row.target:=p_employee::text;row.valid_from:=day;row.valid_to:=day;
   row.payload:=jsonb_set(resolution#>'{payload,schedule}','{days}',to_jsonb(array[extract(dow from day)::integer]));
   row.reason:='Exceção de calendário: '||(resolution->>'name');row.created_by:=(resolution->>'createdBy')::uuid;row.created_at:=(resolution->>'createdAt')::timestamptz; row.revoked_at:=null;
   return next row;
  elsif resolution->>'state'='unchanged' then
   for row in select * from public.monitoring_settings where kind='schedule' and target=p_employee::text and revoked_at is null and valid_from<=day and (valid_to is null or valid_to>=day) loop
    row.valid_from:=day;row.valid_to:=day;return next row;
   end loop;
  end if;
 end loop;
end $$;
-- Off days retain the base schedule only for event attribution. They never become expected workdays.
create function private.schedule_attribution_rows(p_employee uuid,p_start date,p_end date) returns setof public.monitoring_settings
language plpgsql stable security definer set search_path='' as $$
declare day date; row public.monitoring_settings; adjacent date; resolution jsonb;
begin
 if p_end-p_start>368 then raise exception 'PLANNING_PERIOD_TOO_LARGE';end if;
 if not exists(select 1 from private.planning_configurations where active and kind='calendar' and valid_from<=p_end and valid_to>=p_start and (scope='global' or p_employee=any(member_ids))) then
  return query select * from public.monitoring_settings where kind='schedule' and target=p_employee::text and revoked_at is null and valid_from<=p_end and (valid_to is null or valid_to>=p_start);return;
 end if;
 for day in select d::date from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d loop
  resolution:=private.calendar_resolution(p_employee,day);
  if resolution->>'state'='off' then
   for row in select * from public.monitoring_settings where kind='schedule' and target=p_employee::text and revoked_at is null and valid_from<=day and (valid_to is null or valid_to>=day) loop
    row.valid_from:=day;row.valid_to:=day;return next row;
   end loop;
   if not found then
    -- A schedule ending the previous day still owns its overnight exit. The neighboring
    -- payload supplies a boundary fallback only; the off marker suppresses all obligation.
    foreach adjacent in array array[day-1,day+1,(resolution->>'validFrom')::date-1,(resolution->>'validTo')::date+1] loop
     if (select count(*) from private.schedule_window_rows(p_employee,adjacent,adjacent) s where s.payload->'days' @> to_jsonb(array[extract(dow from adjacent)::integer]))=1 then
      select * into row from private.schedule_window_rows(p_employee,adjacent,adjacent) s where s.payload->'days' @> to_jsonb(array[extract(dow from adjacent)::integer]);
      row.valid_from:=day;row.valid_to:=day;row.payload:=jsonb_set(row.payload,'{days}',to_jsonb(array[extract(dow from day)::integer]));return next row;exit;
     end if;
    end loop;
   end if;
  else
   for row in select * from private.schedule_window_rows(p_employee,day,day) loop row.valid_from:=day;row.valid_to:=day;return next row;end loop;
  end if;
 end loop;
end $$;
revoke all on function private.schedule_attribution_rows(uuid,date,date) from public,anon,authenticated,service_role;
-- Preserve the complete original snapshot and derive effective schedules identically for workers and manual recalculation.
-- Coverage arriving after an exception must also discover expected days without punches.
do $$ declare definition text; needle text:='from public.monitoring_settings ms where ms.kind=''schedule'''; begin
 definition:=pg_get_functiondef('private.monitoring_enqueue(uuid,date,date,text)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'CALENDAR_ENQUEUE_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,'from private.schedule_window_rows(b.employee_id,d::date,d::date) ms where ms.kind=''schedule''');
 definition:=pg_get_functiondef('private.monitoring_prepare_identity(uuid,text,text,text,date,date,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'CALENDAR_IDENTITY_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,'from private.schedule_window_rows(p_employee,d::date,d::date) ms where ms.kind=''schedule''');
end $$;
alter function private.monitoring_input(uuid,date,date) rename to monitoring_input_before_calendar;
create function private.monitoring_input(employee uuid,start_date date,end_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb; schedules jsonb; other_settings jsonb; calendar jsonb;
begin
 snapshot:=private.monitoring_input_before_calendar(employee,start_date,end_date);
 select jsonb_agg(private.calendar_resolution(employee,d::date)-'payload'-'createdBy'-'createdAt') into calendar from generate_series((start_date-1)::timestamp,(end_date+1)::timestamp,interval '1 day') d;
 if not exists(select 1 from jsonb_array_elements(calendar) x where x->>'state'<>'unchanged') then return snapshot||jsonb_build_object('calendar',calendar);end if;
 select coalesce(jsonb_agg(value),'[]') into other_settings from jsonb_array_elements(snapshot->'settings') where value->>'kind'<>'schedule';
 select coalesce(jsonb_agg(to_jsonb(s)),'[]') into schedules from private.schedule_attribution_rows(employee,start_date-1,end_date+1) s;
 return snapshot||jsonb_build_object('settings',other_settings||schedules,'calendar',calendar);
end $$;
-- Use effective schedules for current and neighboring operational dates, preserving all identity/coverage/manual checks.
do $$ declare definition text; needle text:='from public.monitoring_settings where kind=''schedule'' and target=p_employee::text and revoked_at is null'; begin
 definition:=pg_get_functiondef('private.daily_call_evidence(uuid,date)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>4 then raise exception 'DAILY_CALENDAR_DEFINITION_CHANGED'; end if;
 execute replace(definition,needle,'from private.schedule_attribution_rows(p_employee,p_date-1,p_date+1) where kind=''schedule'' and target=p_employee::text and revoked_at is null');
end $$;
alter function private.daily_call_evidence(uuid,date) rename to daily_call_evidence_before_calendar;
create function private.daily_call_evidence(p_employee uuid,p_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; calendar jsonb;
begin
 result:=private.daily_call_evidence_before_calendar(p_employee,p_date);
 calendar:=private.calendar_resolution(p_employee,p_date);
 if calendar->>'state'='off' then
  result:=result||jsonb_build_object('expected',false);
  if result->>'state'<>'present' then result:=result||jsonb_build_object('state','not_expected','status',null,'blockers','[]'::jsonb);end if;
 end if;
 return result||jsonb_build_object('calendar',calendar-'payload'-'createdBy'-'createdAt');
end $$;

create function private.planning_prepare_calendar(p_start date,p_end date) returns void language plpgsql security definer set search_path='' as $$
begin
 -- Explicit calendar bounds are a re-evaluation request, not evidence of absence.
 insert into public.monitoring_jobs(employee_id,operational_date,reason)
 select c.id,d::date,'Calendário operacional revisado' from public.colaboradores c cross join generate_series((p_start-1)::timestamp,(p_end+1)::timestamp,interval '1 day') d
 where (c.ativo_no_sistema and exists(select 1 from public.monitoring_bindings b where b.employee_id=c.id and b.revoked_at is null)) or exists(select 1 from private.daily_call_decisions x where x.employee_id=c.id and x.operational_date=d::date) or exists(select 1 from public.monitoring_results r where r.employee_id=c.id and r.operational_date=d::date and r.active)
 order by c.id,d on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
end $$;

create function private.planning_validate_schedule(p jsonb) returns void language plpgsql immutable set search_path='' as $$
declare value jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' or length(btrim(coalesce(p->>'name',''))) not between 1 and 200 or coalesce(p->>'start','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p->>'end','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or jsonb_typeof(p->'days') is distinct from 'array' or jsonb_typeof(p->'allowNoBreak') is distinct from 'boolean' or coalesce(p->>'pairing','') not in ('explicit','alternating') then raise exception 'PLANNING_INVALID_INPUT';end if;
 if jsonb_array_length(p->'days') not between 1 and 7 or jsonb_array_length(p->'days')<>(select count(distinct x) from jsonb_array_elements(p->'days')x) then raise exception 'PLANNING_INVALID_INPUT';end if;
 for value in select * from jsonb_array_elements(p->'days') loop if value::text!~'^[0-6]$' then raise exception 'PLANNING_INVALID_INPUT';end if;end loop;
 if p ? 'coffeeWindows' then
  if jsonb_typeof(p->'coffeeWindows')<>'array' then raise exception 'PLANNING_INVALID_INPUT';end if;
  if jsonb_array_length(p->'coffeeWindows')>5 then raise exception 'PLANNING_INVALID_INPUT';end if;
  for value in select * from jsonb_array_elements(p->'coffeeWindows') loop if coalesce(value->>'start','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(value->>'end','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'PLANNING_INVALID_INPUT';end if;end loop;
 end if;
end $$;
revoke all on function private.planning_validate_schedule(jsonb) from public,anon,authenticated,service_role;

create function private.schedule_planning_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); role_name public.papel_usuario; manager uuid; item uuid; old private.planning_configurations; fresh private.planning_configurations;
 result jsonb; options jsonb; rows jsonb; employee uuid; template private.planning_configurations; ids uuid[]; members uuid[];
 start_date date; end_date date; reason text:=btrim(p_data->>'reason'); payload jsonb; expected timestamptz; created_ids jsonb:='[]'; before_record jsonb; field_name text;
begin
 if p_action is null or p_action not in ('list','save','archive','restore','assign','suggest','accept_suggestion') or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'PLANNING_INVALID_INPUT'; end if;
 if p_action not in ('list','suggest') then perform pg_advisory_xact_lock(824202609,1);perform pg_advisory_xact_lock(791800,1);perform pg_advisory_xact_lock(791810,1);end if;
 select papel_usuario,gestor_id into role_name,manager from public.perfis where id=actor and status_usuario='APROVADO' for share;
 if role_name is null then raise exception using errcode='42501',message='PLANNING_FORBIDDEN'; end if;
 if p_action in ('save','archive','restore','assign') and role_name not in ('ADMIN','RH') then raise exception using errcode='42501',message='PLANNING_FORBIDDEN'; end if;
 if p_action='list' then
  select coalesce(jsonb_agg(private.planning_row(id) order by kind,name,id),'[]') into rows from private.planning_configurations p
   where role_name<>'GESTOR' or scope='global' or exists(select 1 from public.colaboradores c where c.gestor_id=manager and c.id=any(p.member_ids));
  select jsonb_build_object(
   'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',nome,'employeeNumber',matricula,'managerId',gestor_id,'unitId',unidade_id,'active',ativo_no_sistema,'admissionDate',admissao,'situation',situacao) order by nome,id),'[]') from public.colaboradores where role_name<>'GESTOR' or gestor_id=manager),
   'managers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',nome) order by nome,id),'[]') from public.gestores where ativo and (role_name<>'GESTOR' or id=manager)),
   'units',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',nome) order by nome,id),'[]') from public.unidades where ativo)) into options;
  return jsonb_build_object('records',rows,'options',options,'rosterVersion',private.planning_roster_version(),'canManage',role_name in ('ADMIN','RH'),'canPropose',role_name in ('ADMIN','RH') or (role_name='GESTOR' and manager is not null));
 end if;
 if p_action='suggest' then return private.vacation_suggestions(p_data,role_name,manager); end if;
 if coalesce(length(reason),0) not between 5 and 1000 then raise exception 'PLANNING_INVALID_INPUT'; end if;
 if p_action='accept_suggestion' then
  if role_name not in ('ADMIN','RH','GESTOR') then raise exception using errcode='42501',message='PLANNING_FORBIDDEN'; end if;
  result:=private.vacation_suggestions(p_data,role_name,manager);
  if result->>'version' is distinct from p_data->>'expectedVersion' then raise exception 'PLANNING_STALE'; end if;
  select value into payload from jsonb_array_elements(result->'suggestions') where value->>'startDate'=p_data->>'selectedStart';
  if payload is null then raise exception 'PLANNING_SUGGESTION_UNAVAILABLE'; end if;
  return private.administration_impl('vacation','save',jsonb_build_object('employeeId',p_data->>'employeeId','startDate',payload->>'startDate','endDate',payload->>'endDate','status','draft','reason',reason,'observation','Sugestão conforme política RH; aprovação permanece manual.'));
 end if;
 perform pg_advisory_xact_lock(791702);
 -- Managed ingestion serializes source writes with this lock before acquiring jobs/revision.
 perform pg_advisory_xact_lock(791704);
 if p_action='assign' then
  select * into template from private.planning_configurations where id=(p_data->>'templateId')::uuid and kind='template' and active for update;
  if not found then raise exception 'PLANNING_NOT_FOUND'; end if;
  if (p_data->>'expectedTemplateUpdatedAt')::timestamptz is distinct from template.updated_at or p_data->>'expectedRosterVersion' is distinct from private.planning_roster_version() then raise exception 'PLANNING_STALE'; end if;
  if jsonb_typeof(p_data->'employeeIds') is distinct from 'array' then raise exception 'PLANNING_INVALID_INPUT'; end if;
  select array_agg(value::uuid order by value) into ids from jsonb_array_elements_text(p_data->'employeeIds');
  if coalesce(cardinality(ids),0) not between 1 and 500 or cardinality(ids)<>(select count(distinct x) from unnest(ids)x) or exists(select 1 from unnest(ids)x where not exists(select 1 from public.colaboradores where id=x and ativo_no_sistema)) then raise exception 'PLANNING_INVALID_INPUT'; end if;
  start_date:=(p_data->>'validFrom')::date;end_date:=(p_data->>'validTo')::date;
  if start_date is null or end_date is null or not isfinite(start_date) or not isfinite(end_date) or end_date<start_date or end_date-start_date>366 or start_date<template.valid_from or (template.valid_to is not null and end_date>template.valid_to) then raise exception 'PLANNING_INVALID_INPUT'; end if;
  foreach employee in array ids loop perform private.monitoring_prepare_setting_change(employee,start_date-1,end_date+1);end loop;
  perform 1 from private.monitoring_revision where id=true for update;
  foreach employee in array ids loop
   result:=private.monitoring_query_impl('setting',jsonb_build_object('kind','schedule','target',employee,'validFrom',start_date,'validTo',end_date,'payload',template.payload,'reason',reason));
   created_ids:=created_ids||jsonb_build_array(result->>'id');
  end loop;
  update public.monitoring_results set dirty=true where active and employee_id=any(ids) and operational_date between start_date-1 and end_date+1;
  insert into private.administration_audit(entity,entity_id,action,actor,reason,before_record,after_record) values('schedule_assignment',template.id,'save',actor,reason,null,jsonb_build_object('template',private.planning_row(template.id),'employeeIds',ids,'settingIds',created_ids,'validFrom',start_date,'validTo',end_date));
  return jsonb_build_object('assigned',cardinality(ids),'settingIds',created_ids);
 end if;
 item:=(p_data->>'id')::uuid;
 if item is not null then
  select * into old from private.planning_configurations where id=item for update;
  if not found then raise exception 'PLANNING_NOT_FOUND'; end if;
  expected:=(p_data->>'expectedUpdatedAt')::timestamptz;
  if expected is distinct from old.updated_at then raise exception 'PLANNING_STALE'; end if;
  before_record:=private.planning_row(item);
 elsif p_action<>'save' or p_data->>'expectedUpdatedAt' is not null then raise exception 'PLANNING_INVALID_INPUT';end if;
 if p_action='save' then
  if old.id is not null and (not old.active or p_data->>'kind' is distinct from old.kind) then raise exception 'PLANNING_INVALID_INPUT';end if;
  fresh.kind:=p_data->>'kind';fresh.name:=btrim(p_data->>'name');fresh.scope:=p_data->>'scope';fresh.target:=(p_data->>'target')::uuid;
  fresh.valid_from:=(p_data->>'validFrom')::date;fresh.valid_to:=(p_data->>'validTo')::date;fresh.payload:=p_data->'payload';
  if fresh.kind is null or fresh.kind not in ('template','calendar','vacation_policy') or coalesce(length(fresh.name),0) not between 1 and 200 or fresh.scope is null or fresh.scope not in ('global','unit','manager','person') or (fresh.scope='global')<>(fresh.target is null) or fresh.valid_from is null or not isfinite(fresh.valid_from) or (fresh.valid_to is not null and (not isfinite(fresh.valid_to) or fresh.valid_to<fresh.valid_from)) or jsonb_typeof(fresh.payload) is distinct from 'object' then raise exception 'PLANNING_INVALID_INPUT';end if;
  if (fresh.scope='unit' and not exists(select 1 from public.unidades where id=fresh.target and ativo)) or (fresh.scope='manager' and not exists(select 1 from public.gestores where id=fresh.target and ativo)) or (fresh.scope='person' and not exists(select 1 from public.colaboradores where id=fresh.target and ativo_no_sistema)) then raise exception 'PLANNING_INVALID_INPUT';end if;
  select coalesce(array_agg(id order by id),'{}') into fresh.member_ids from public.colaboradores where ativo_no_sistema and (fresh.scope='global' or (fresh.scope='unit' and unidade_id=fresh.target) or (fresh.scope='manager' and gestor_id=fresh.target) or (fresh.scope='person' and id=fresh.target));
  if old.id is not null and old.scope=fresh.scope and old.target is not distinct from fresh.target then fresh.member_ids:=old.member_ids;end if;
  if fresh.kind='template' then
   if fresh.scope<>'global' then raise exception 'PLANNING_INVALID_INPUT';end if;
   perform private.planning_validate_schedule(fresh.payload);
  elsif fresh.kind='calendar' then
   if fresh.valid_to is null or fresh.valid_to-fresh.valid_from>30 or jsonb_typeof(fresh.payload->'working') is distinct from 'boolean' then raise exception 'PLANNING_INVALID_INPUT';end if;
   if (fresh.payload->>'working')::boolean then
    select * into template from private.planning_configurations where id=(fresh.payload->>'templateId')::uuid and kind='template' and active;
    if not found or (fresh.payload->>'expectedTemplateUpdatedAt')::timestamptz is distinct from template.updated_at then raise exception 'PLANNING_STALE';end if;
    if fresh.valid_from<template.valid_from or (template.valid_to is not null and fresh.valid_to>template.valid_to) then raise exception 'PLANNING_INVALID_INPUT';end if;
    fresh.payload:=jsonb_build_object('working',true,'templateId',template.id,'schedule',template.payload);
   else fresh.payload:=jsonb_build_object('working',false);end if;
   if exists(select 1 from private.planning_configurations where kind='calendar' and active and id is distinct from item and scope=fresh.scope and (target is not distinct from fresh.target or member_ids && fresh.member_ids) and valid_from<=fresh.valid_to and valid_to>=fresh.valid_from) then raise exception 'PLANNING_VALIDITY_CONFLICT';end if;
  else
   foreach field_name in array array['minimumTenureDays','durationDays','noticeDays','minimumAvailable'] loop
    if jsonb_typeof(fresh.payload->field_name) is distinct from 'number' or (fresh.payload->>field_name)!~'^[0-9]+$' then raise exception 'PLANNING_INVALID_INPUT';end if;
   end loop;
   if jsonb_typeof(fresh.payload->'maximumAbsentPercent') is distinct from 'number' then raise exception 'PLANNING_INVALID_INPUT';end if;
   if fresh.scope not in ('global','manager','unit') or (fresh.payload->>'minimumTenureDays')::integer not between 0 and 3650 or (fresh.payload->>'durationDays')::integer not between 1 and 60 or (fresh.payload->>'noticeDays')::integer not between 0 and 365 or (fresh.payload->>'maximumAbsentPercent')::numeric not between 0 and 100 or (fresh.payload->>'minimumAvailable')::integer not between 0 and 5000 or jsonb_typeof(fresh.payload->'includeRequested') is distinct from 'boolean'
    or not(fresh.payload ?& array['minimumTenureDays','durationDays','noticeDays','maximumAbsentPercent','minimumAvailable','includeRequested']) then raise exception 'PLANNING_INVALID_INPUT';end if;
  end if;
 elsif (p_action='archive' and not old.active) or (p_action='restore' and old.active) then raise exception 'PLANNING_STALE';
 else fresh:=old;end if;
 if fresh.kind='calendar' then
  perform private.planning_prepare_calendar(fresh.valid_from,fresh.valid_to);
  if old.id is not null and (old.valid_from,old.valid_to) is distinct from (fresh.valid_from,fresh.valid_to) then perform private.planning_prepare_calendar(old.valid_from,old.valid_to);end if;
  perform 1 from private.monitoring_revision where id=true for update;
 end if;
 if p_action='save' then
  if item is null then insert into private.planning_configurations(kind,name,scope,target,member_ids,valid_from,valid_to,payload,created_by) values(fresh.kind,fresh.name,fresh.scope,fresh.target,fresh.member_ids,fresh.valid_from,fresh.valid_to,fresh.payload,actor) returning id into item;
  else update private.planning_configurations set name=fresh.name,scope=fresh.scope,target=fresh.target,member_ids=fresh.member_ids,valid_from=fresh.valid_from,valid_to=fresh.valid_to,payload=fresh.payload where id=item;end if;
 else
  if p_action='restore' and fresh.kind='calendar' and exists(select 1 from private.planning_configurations where kind='calendar' and active and id<>item and scope=fresh.scope and (target is not distinct from fresh.target or member_ids && fresh.member_ids) and valid_from<=fresh.valid_to and valid_to>=fresh.valid_from) then raise exception 'PLANNING_VALIDITY_CONFLICT';end if;
  update private.planning_configurations set active=(p_action='restore') where id=item;
 end if;
 if fresh.kind='calendar' then
  update private.monitoring_revision set version=version+1 where id=true;
  update private.daily_call_revision set version=version+1 where id=true;
  update public.monitoring_results set dirty=true where active and (operational_date between fresh.valid_from-1 and fresh.valid_to+1 or operational_date between old.valid_from-1 and old.valid_to+1);
 end if;
 result:=private.planning_row(item);
 insert into private.administration_audit(entity,entity_id,action,actor,reason,before_record,after_record) values('planning_'||fresh.kind,item,p_action,actor,reason,before_record,result);
 return jsonb_build_object('record',result,'changed',true);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'PLANNING_INVALID_INPUT';
end $$;

create function public.schedule_planning(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.schedule_planning_impl(p_action,p_data) $$;
revoke all on function public.schedule_planning(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.schedule_planning(text,jsonb) to authenticated;
revoke all on function private.planning_row(uuid),private.planning_roster_version(),private.calendar_resolution(uuid,date),private.schedule_window_rows(uuid,date,date),private.monitoring_input(uuid,date,date),private.daily_call_evidence(uuid,date),private.planning_prepare_calendar(date,date),private.vacation_suggestions(jsonb,public.papel_usuario,uuid),private.schedule_planning_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.schedule_planning_impl(text,jsonb) to authenticated;
