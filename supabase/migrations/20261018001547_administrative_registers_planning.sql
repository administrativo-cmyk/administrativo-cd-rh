-- Administrative registers and vacation proposals. Approval never writes attendance,
-- punch events or bank-hours balances. Existing register IDs and history are preserved.
create table public.ferias_planejamento (
 id uuid primary key default gen_random_uuid(),
 colaborador_id uuid not null references public.colaboradores(id) on delete restrict,
 inicio_aquisitivo date, fim_aquisitivo date,
 inicio date not null, fim date not null,
 status text not null check(status in ('draft','requested','approved','cancelled')),
 observacao text check(length(observacao)<=1000),
 created_by uuid not null references public.perfis(id) on delete restrict,
 approved_by uuid references public.perfis(id) on delete restrict, approved_at timestamptz,
 archived_at timestamptz, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 constraint ferias_planejamento_periodo check(isfinite(inicio) and isfinite(fim) and fim>=inicio),
 constraint ferias_planejamento_aquisitivo check((inicio_aquisitivo is null and fim_aquisitivo is null) or (inicio_aquisitivo is not null and fim_aquisitivo is not null and isfinite(inicio_aquisitivo) and isfinite(fim_aquisitivo) and fim_aquisitivo>=inicio_aquisitivo)),
 constraint ferias_planejamento_aprovacao check((status='approved' and approved_by is not null and approved_at is not null) or (status<>'approved' and approved_by is null and approved_at is null))
);
create index ferias_planejamento_colaborador_periodo on public.ferias_planejamento(colaborador_id,inicio,fim);
create index ferias_planejamento_created_by on public.ferias_planejamento(created_by,updated_at desc);
create index ferias_planejamento_approved_by on public.ferias_planejamento(approved_by);
alter table public.ferias_planejamento enable row level security;
revoke all on public.ferias_planejamento from public,anon,authenticated,service_role;

create table private.administration_audit (
 id bigint generated always as identity primary key, entity text not null, entity_id uuid not null,
 action text not null check(action in ('save','archive','restore')), actor uuid not null references public.perfis(id) on delete restrict,
 reason text not null check(length(btrim(reason)) between 5 and 1000),
 before_record jsonb, after_record jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table private.administration_audit enable row level security;
create index administration_audit_actor on private.administration_audit(actor);
revoke all on private.administration_audit from public,anon,authenticated,service_role;

create function private.administration_touch() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond'); return new; end $$;
revoke all on function private.administration_touch() from public,anon,authenticated,service_role;
-- Runs after the existing *_definir_updated_at triggers in alphabetical order.
create trigger zz_administration_touch before update on public.unidades for each row execute function private.administration_touch();
create trigger zz_administration_touch before update on public.gestores for each row execute function private.administration_touch();
create trigger zz_administration_touch before update on public.colaboradores for each row execute function private.administration_touch();
create trigger zz_administration_touch before update on public.ferias_planejamento for each row execute function private.administration_touch();

create function private.administration_rows(p_entity text) returns setof jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_entity='unit' then
  return query select jsonb_build_object('id',id,'code',codigo,'name',nome,'active',ativo,'createdAt',created_at,'updatedAt',updated_at) from public.unidades;
 elsif p_entity='manager' then
  return query select jsonb_build_object('id',id,'name',nome,'referenceUnitId',unidade_referencia_id,'active',ativo,'createdAt',created_at,'updatedAt',updated_at) from public.gestores;
 elsif p_entity='employee' then
  return query select jsonb_build_object('id',id,'employeeNumber',matricula,'name',nome,'unitId',unidade_id,'managerId',gestor_id,'department',setor,'role',funcao,'situation',situacao,'category',categoria,'admissionDate',admissao,'movement',movimento,'workdayHours',jornada_horas_dia_atual,'activeInSystem',ativo_no_sistema,'observation',observacao,'createdAt',created_at,'updatedAt',updated_at) from public.colaboradores;
 elsif p_entity='vacation' then
  return query select jsonb_build_object('id',f.id,'employeeId',f.colaborador_id,'employeeName',c.nome,'employeeNumber',c.matricula,'managerId',c.gestor_id,'unitId',c.unidade_id,'acquisitionStart',f.inicio_aquisitivo,'acquisitionEnd',f.fim_aquisitivo,'startDate',f.inicio,'endDate',f.fim,'status',f.status,'observation',f.observacao,'createdBy',f.created_by,'approvedBy',f.approved_by,'approvedAt',f.approved_at,'archivedAt',f.archived_at,'createdAt',f.created_at,'updatedAt',f.updated_at,
   'canEdit',f.archived_at is null and exists(select 1 from public.perfis p where p.id=(select auth.uid()) and p.status_usuario='APROVADO' and (p.papel_usuario in ('ADMIN','RH') or (p.papel_usuario='GESTOR' and p.gestor_id=c.gestor_id and f.created_by=p.id and f.status in ('draft','requested')))))
   from public.ferias_planejamento f join public.colaboradores c on c.id=f.colaborador_id;
 end if;
end $$;
revoke all on function private.administration_rows(text) from public,anon,authenticated,service_role;

create function private.administration_impl(p_entity text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid()); v_role public.papel_usuario; v_manager uuid;
 v_id uuid; v_table text; v_old jsonb; v_before jsonb; v_after jsonb; v_rows jsonb; v_total bigint; v_options jsonb;
 v_reason text:=btrim(p_data->>'reason'); v_expected timestamptz;
 v_unit uuid; v_employee_manager uuid; v_employee uuid; v_old_employee uuid;
 v_start date; v_end date; v_acq_start date; v_acq_end date; v_status text; v_hours numeric;
 v_archived boolean; v_include boolean:=coalesce((p_data->>'includeArchived')::boolean,false);
 v_offset integer:=coalesce((p_data->>'offset')::integer,0); v_limit integer:=coalesce((p_data->>'limit')::integer,100);
 v_query text:=coalesce(btrim(p_data->>'query'),''); v_audit bigint; v_dataset text;
begin
 if p_action is distinct from 'list' then
  -- Profile edits take these locks before their target profile; keep the same order.
  perform pg_advisory_xact_lock(824202609,1);
  perform pg_advisory_xact_lock(791800,1);
 end if;
 select papel_usuario,gestor_id into v_role,v_manager from public.perfis where id=v_actor and status_usuario='APROVADO' for share;
 if v_actor is null or v_role is null then raise exception using errcode='42501',message='ADMINISTRATION_FORBIDDEN'; end if;
 if p_entity is null or p_entity not in ('unit','manager','employee','vacation') or p_action is null or p_action not in ('list','save','archive','restore') or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
 if p_entity<>'vacation' and v_role not in ('ADMIN','RH') then raise exception using errcode='42501',message='ADMINISTRATION_FORBIDDEN'; end if;
 if p_action<>'list' and v_role not in ('ADMIN','RH','GESTOR') then raise exception using errcode='42501',message='ADMINISTRATION_FORBIDDEN'; end if;
 if p_action='list' then
  if v_offset<0 or v_offset>100000 or v_limit<1 or v_limit>500 or length(v_query)>100 then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
  if p_data->>'status' is not null and p_data->>'status' not in ('draft','requested','approved','cancelled') then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
  with scoped as (
   select r from private.administration_rows(p_entity) r
   where (v_role<>'GESTOR' or (v_manager is not null and r->>'managerId'=v_manager::text))
    and (v_include or case p_entity when 'vacation' then r->>'archivedAt' is null when 'employee' then (r->>'activeInSystem')::boolean else (r->>'active')::boolean end)
    and (v_query='' or concat_ws(' ',r->>'name',r->>'code',r->>'employeeName',r->>'employeeNumber') ilike '%'||v_query||'%')
    and (p_data->>'managerId' is null or r->>'managerId'=p_data->>'managerId')
    and (p_data->>'employeeId' is null or r->>'employeeId'=p_data->>'employeeId' or (p_entity='employee' and r->>'id'=p_data->>'employeeId'))
    and (p_data->>'status' is null or r->>'status'=p_data->>'status')
  ), page as (select r from scoped order by coalesce(r->>'name',r->>'employeeName'),r->>'startDate',r->>'id' limit v_limit offset v_offset)
  select (select count(*) from scoped),(select coalesce(jsonb_agg(r),'[]'::jsonb) from page),(select coalesce(string_agg(r::text,'|' order by r->>'id'),'') from scoped) into v_total,v_rows,v_dataset;
  select jsonb_build_object(
   'units',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',codigo,'name',nome,'active',ativo) order by nome,id),'[]'::jsonb) from public.unidades),
   'managers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',nome,'active',ativo) order by nome,id),'[]'::jsonb) from public.gestores where v_role<>'GESTOR' or id=v_manager),
   'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',nome,'employeeNumber',matricula,'managerId',gestor_id,'unitId',unidade_id,'activeInSystem',ativo_no_sistema) order by nome,id),'[]'::jsonb) from public.colaboradores where v_role<>'GESTOR' or (v_manager is not null and gestor_id=v_manager))
  ) into v_options;
  return jsonb_build_object('datasetVersion',encode(sha256(convert_to(concat_ws('|',p_entity,v_actor,v_role,v_manager,v_dataset,v_options::text),'UTF8')),'hex'),'entity',p_entity,'rows',v_rows,'total',v_total,'options',v_options,'permissions',jsonb_build_object('canManageRegisters',v_role in ('ADMIN','RH'),'canApproveVacation',v_role in ('ADMIN','RH'),'canProposeVacation',v_role in ('ADMIN','RH') or (v_role='GESTOR' and v_manager is not null)));
 end if;

 if coalesce(length(v_reason),0) not between 5 and 1000 then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
 -- Serializes register references and approved vacation overlap checks, including archives.
 perform pg_advisory_xact_lock(791800,1);
 v_id:=(p_data->>'id')::uuid;
 if p_entity='employee' then
  -- Match worker finish: job rows -> input revision -> employee references.
  -- Binding writes hold 791701 around identity FK checks and revision updates.
  perform pg_advisory_xact_lock(791701);
  if v_id is not null then
   perform private.monitoring_enqueue(v_id,null,null,null);
   -- Include clean historical results even when their events or bindings are no longer active.
   -- Lock jobs before revision/employee, matching the worker completion order.
   insert into public.monitoring_jobs(employee_id,operational_date,reason)
   select employee_id,operational_date,'Cadastro alterado' from public.monitoring_results
   where active and employee_id=v_id order by operational_date
   on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
  end if;
  perform 1 from private.monitoring_revision where id=true for update;
 end if;
 v_table:=case p_entity when 'unit' then 'unidades' when 'manager' then 'gestores' when 'employee' then 'colaboradores' else 'ferias_planejamento' end;
 if v_id is not null then
  v_expected:=(p_data->>'expectedUpdatedAt')::timestamptz;
  execute format('select to_jsonb(t) from public.%I t where id=$1 for update',v_table) into v_old using v_id;
  if v_old is null then raise exception 'ADMINISTRATION_NOT_FOUND'; end if;
  select r into v_before from private.administration_rows(p_entity) r where r->>'id'=v_id::text;
  if v_expected is null or not isfinite(v_expected) or (v_old->>'updated_at')::timestamptz is distinct from v_expected then raise exception 'ADMINISTRATION_STALE'; end if;
  v_archived:=case p_entity when 'vacation' then v_old->>'archived_at' is not null when 'employee' then not (v_old->>'ativo_no_sistema')::boolean else not (v_old->>'ativo')::boolean end;
  if p_action='save' and v_archived then raise exception 'ADMINISTRATION_ARCHIVED'; end if;
 elsif p_action<>'save' or p_data->>'expectedUpdatedAt' is not null then raise exception 'ADMINISTRATION_INVALID_INPUT';
 end if;

 if p_entity='vacation' then
  v_old_employee:=(v_old->>'colaborador_id')::uuid;
  v_employee:=case when p_action='save' then (p_data->>'employeeId')::uuid else v_old_employee end;
  select gestor_id into v_employee_manager from public.colaboradores where id=v_employee for share;
  if not found then raise exception 'ADMINISTRATION_INACTIVE_REFERENCE'; end if;
  if p_action<>'archive' and not exists(select 1 from public.colaboradores where id=v_employee and ativo_no_sistema) then raise exception 'ADMINISTRATION_INACTIVE_REFERENCE'; end if;
  if v_role='GESTOR' then
   if v_manager is null or v_employee_manager is distinct from v_manager then raise exception using errcode='42501',message='ADMINISTRATION_FORBIDDEN'; end if;
   if v_old is not null and ((v_old->>'created_by')::uuid<>v_actor or v_old->>'status'='approved' or v_old_employee is distinct from v_employee or not exists(select 1 from public.colaboradores where id=v_old_employee and gestor_id=v_manager)) then raise exception using errcode='42501',message='ADMINISTRATION_FORBIDDEN'; end if;
   if p_action='save' and (p_data->>'status' not in ('draft','requested','cancelled') or (v_old is null and p_data->>'status'='cancelled') or v_old->>'status'='cancelled') then raise exception 'ADMINISTRATION_VACATION_LOCKED'; end if;
  end if;
 end if;

 if p_action in ('archive','restore') then
  if p_action='archive' and v_archived or p_action='restore' and not v_archived then raise exception 'ADMINISTRATION_STALE'; end if;
  if p_action='archive' and p_entity='unit' and (exists(select 1 from public.colaboradores where unidade_id=v_id and ativo_no_sistema) or exists(select 1 from public.gestores where unidade_referencia_id=v_id and ativo)) then raise exception 'ADMINISTRATION_REFERENCED'; end if;
  if p_action='archive' and p_entity='manager' and (exists(select 1 from public.colaboradores where gestor_id=v_id and ativo_no_sistema) or exists(select 1 from public.perfis where gestor_id=v_id)) then raise exception 'ADMINISTRATION_REFERENCED'; end if;
  if p_action='restore' and p_entity='manager' and v_old->>'unidade_referencia_id' is not null and not exists(select 1 from public.unidades where id=(v_old->>'unidade_referencia_id')::uuid and ativo) then raise exception 'ADMINISTRATION_INACTIVE_REFERENCE'; end if;
  if p_action='restore' and p_entity='employee' and (not exists(select 1 from public.unidades where id=(v_old->>'unidade_id')::uuid and ativo) or (v_old->>'gestor_id' is not null and not exists(select 1 from public.gestores where id=(v_old->>'gestor_id')::uuid and ativo))) then raise exception 'ADMINISTRATION_INACTIVE_REFERENCE'; end if;
  if p_action='restore' and p_entity='vacation' and v_old->>'status'='approved' and exists(select 1 from public.ferias_planejamento where colaborador_id=v_employee and id<>v_id and archived_at is null and status='approved' and inicio<=(v_old->>'fim')::date and fim>=(v_old->>'inicio')::date) then raise exception 'ADMINISTRATION_VACATION_OVERLAP'; end if;
  if p_entity='vacation' then
   update public.ferias_planejamento set archived_at=case when p_action='archive' then clock_timestamp() else null end where id=v_id;
  else
   execute format('update public.%I set %I=$1 where id=$2',v_table,case when p_entity='employee' then 'ativo_no_sistema' else 'ativo' end) using p_action='restore',v_id;
  end if;
 elsif p_entity='unit' then
  if coalesce(length(btrim(p_data->>'code')),0) not between 1 and 40 or coalesce(length(btrim(p_data->>'name')),0) not between 1 and 200 then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
  if exists(select 1 from public.unidades where lower(btrim(codigo))=lower(btrim(p_data->>'code')) and id is distinct from v_id) then raise exception 'ADMINISTRATION_DUPLICATE'; end if;
  if v_id is null then insert into public.unidades(codigo,nome) values(btrim(p_data->>'code'),btrim(p_data->>'name')) returning id into v_id;
  else update public.unidades set codigo=btrim(p_data->>'code'),nome=btrim(p_data->>'name') where id=v_id; end if;
 elsif p_entity='manager' then
  if coalesce(length(btrim(p_data->>'name')),0) not between 1 and 200 then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
  v_unit:=(p_data->>'referenceUnitId')::uuid;
  if v_unit is not null and not exists(select 1 from public.unidades where id=v_unit and ativo) then raise exception 'ADMINISTRATION_INACTIVE_REFERENCE'; end if;
  if v_id is null then insert into public.gestores(nome,unidade_referencia_id) values(btrim(p_data->>'name'),v_unit) returning id into v_id;
  else update public.gestores set nome=btrim(p_data->>'name'),unidade_referencia_id=v_unit where id=v_id; end if;
 elsif p_entity='employee' then
  if coalesce(length(btrim(p_data->>'employeeNumber')),0) not between 1 and 100 or coalesce(length(btrim(p_data->>'name')),0) not between 1 and 200
   or length(p_data->>'department')>200 or length(p_data->>'role')>200 or length(p_data->>'category')>200 or length(p_data->>'movement')>200 or length(p_data->>'observation')>1000 then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
  v_hours:=(p_data->>'workdayHours')::numeric;
  if v_hours is null or v_hours<=0 or v_hours>24 then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
  v_unit:=(p_data->>'unitId')::uuid; v_employee_manager:=(p_data->>'managerId')::uuid;
  if not exists(select 1 from public.unidades where id=v_unit and ativo) or (v_employee_manager is not null and not exists(select 1 from public.gestores where id=v_employee_manager and ativo)) then raise exception 'ADMINISTRATION_INACTIVE_REFERENCE'; end if;
  if p_data->>'admissionDate' is not null and not isfinite((p_data->>'admissionDate')::date) then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
  if exists(select 1 from public.colaboradores where btrim(matricula)=btrim(p_data->>'employeeNumber') and id is distinct from v_id) then raise exception 'ADMINISTRATION_DUPLICATE'; end if;
  if v_id is null then
   insert into public.colaboradores(matricula,nome,unidade_id,gestor_id,setor,funcao,situacao,categoria,admissao,movimento,jornada_horas_dia_atual,observacao)
   values(btrim(p_data->>'employeeNumber'),btrim(p_data->>'name'),v_unit,v_employee_manager,nullif(btrim(p_data->>'department'),''),nullif(btrim(p_data->>'role'),''),(p_data->>'situation')::public.situacao_colaborador,nullif(btrim(p_data->>'category'),''),(p_data->>'admissionDate')::date,nullif(btrim(p_data->>'movement'),''),v_hours,nullif(btrim(p_data->>'observation'),'')) returning id into v_id;
  else
   update public.colaboradores set matricula=btrim(p_data->>'employeeNumber'),nome=btrim(p_data->>'name'),unidade_id=v_unit,gestor_id=v_employee_manager,setor=nullif(btrim(p_data->>'department'),''),funcao=nullif(btrim(p_data->>'role'),''),situacao=(p_data->>'situation')::public.situacao_colaborador,categoria=nullif(btrim(p_data->>'category'),''),admissao=(p_data->>'admissionDate')::date,movimento=nullif(btrim(p_data->>'movement'),''),jornada_horas_dia_atual=v_hours,observacao=nullif(btrim(p_data->>'observation'),'') where id=v_id;
  end if;
 elsif p_entity='vacation' then
  v_start:=(p_data->>'startDate')::date; v_end:=(p_data->>'endDate')::date;
  v_acq_start:=(p_data->>'acquisitionStart')::date; v_acq_end:=(p_data->>'acquisitionEnd')::date; v_status:=p_data->>'status';
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_end<v_start or v_status is null or v_status not in ('draft','requested','approved','cancelled')
   or (v_acq_start is null)<>(v_acq_end is null) or (v_acq_start is not null and (not isfinite(v_acq_start) or not isfinite(v_acq_end) or v_acq_end<v_acq_start)) or length(p_data->>'observation')>1000 then raise exception 'ADMINISTRATION_INVALID_INPUT'; end if;
  if v_status='approved' and exists(select 1 from public.ferias_planejamento where colaborador_id=v_employee and id is distinct from v_id and archived_at is null and status='approved' and inicio<=v_end and fim>=v_start) then raise exception 'ADMINISTRATION_VACATION_OVERLAP'; end if;
  if v_id is null then
   insert into public.ferias_planejamento(colaborador_id,inicio_aquisitivo,fim_aquisitivo,inicio,fim,status,observacao,created_by,approved_by,approved_at)
   values(v_employee,v_acq_start,v_acq_end,v_start,v_end,v_status,nullif(btrim(p_data->>'observation'),''),v_actor,case when v_status='approved' then v_actor end,case when v_status='approved' then clock_timestamp() end) returning id into v_id;
  else
   update public.ferias_planejamento set colaborador_id=v_employee,inicio_aquisitivo=v_acq_start,fim_aquisitivo=v_acq_end,inicio=v_start,fim=v_end,status=v_status,observacao=nullif(btrim(p_data->>'observation'),''),approved_by=case when v_status='approved' then v_actor end,approved_at=case when v_status='approved' then clock_timestamp() end where id=v_id;
  end if;
 end if;
 select r into v_after from private.administration_rows(p_entity) r where r->>'id'=v_id::text;
 insert into private.administration_audit(entity,entity_id,action,actor,reason,before_record,after_record) values(p_entity,v_id,p_action,v_actor,v_reason,v_before,v_after) returning id into v_audit;
 -- Existing register edits affect cached reads and scope; no attendance decision is written.
 if p_entity='employee' then
  update private.monitoring_revision set version=version+1 where id=true;
  update private.daily_call_revision set version=version+1 where id=true;
  update public.monitoring_results set dirty=true where active and employee_id=v_id;
 elsif p_entity in ('manager','unit') then
  -- Display metadata is joined at read time; it must not strand clean journeys.
  update private.monitoring_revision set results_version=results_version+1 where id=true;
  update private.daily_call_revision set version=version+1 where id=true;
 end if;
 return jsonb_build_object('id',v_id,'record',v_after,'changed',true,'auditId',v_audit);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or not_null_violation or check_violation then raise exception 'ADMINISTRATION_INVALID_INPUT';
end $$;
revoke all on function private.administration_impl(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.administration_impl(text,text,jsonb) to authenticated;
create function public.administration(p_entity text,p_action text,p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select private.administration_impl(p_entity,p_action,p_data) $$;
revoke all on function public.administration(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.administration(text,text,jsonb) to authenticated;
