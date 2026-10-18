-- Reversible measurement management. Existing cycles and imported provenance remain.
alter table public.banco_horas_medicoes
 add column updated_at timestamptz not null default clock_timestamp(),
 add column created_by uuid references public.perfis(id) on delete restrict,
 add column updated_by uuid references public.perfis(id) on delete restrict,
 add column cancelled_at timestamptz,
 add column cancelled_by uuid references public.perfis(id) on delete restrict;
create index banco_horas_medicoes_created_by_idx on public.banco_horas_medicoes(created_by);
create index banco_horas_medicoes_updated_by_idx on public.banco_horas_medicoes(updated_by);
create index banco_horas_medicoes_cancelled_by_idx on public.banco_horas_medicoes(cancelled_by);
alter table public.banco_horas_medicoes drop constraint banco_horas_medicoes_baseline_unique;
create unique index banco_horas_medicoes_active_baseline_unique on public.banco_horas_medicoes(colaborador_id,aplica_a_partir_de) where cancelled_at is null;
create trigger bank_measurement_touch before update on public.banco_horas_medicoes for each row execute function private.administration_touch();

create table private.time_bank_measurement_audit (
 id bigint generated always as identity primary key,
 measurement_id uuid not null references public.banco_horas_medicoes(id) on delete restrict,
 actor uuid not null references public.perfis(id) on delete restrict,
 action text not null check(action in ('create','update','cancel','restore')),
 reason text not null check(length(reason) between 5 and 1000),
 before_record jsonb,after_record jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table private.time_bank_measurement_audit enable row level security;
revoke all on private.time_bank_measurement_audit from public,anon,authenticated,service_role;

-- Keep the existing view columns stable while removing cancelled cycles before LEAD.
create or replace view public.vw_banco_horas_ciclos with(security_invoker=true) as
with ciclos as (
 select m.id,m.colaborador_id,m.data_medicao,m.aplica_a_partir_de,m.jornada_horas_dia,m.saldo_minutos,m.origem,m.lote_importacao_id,m.created_at,
 lead(m.aplica_a_partir_de) over(partition by m.colaborador_id order by m.aplica_a_partir_de,m.data_medicao,m.created_at) as proxima_baseline
 from public.banco_horas_medicoes m where m.cancelled_at is null
),calculados as (
 select c.*,private.converter_saldo_minutos_em_dias(c.saldo_minutos,c.jornada_horas_dia) as saldo_dias,
 count(cd.id) filter(where cd.status='G')::integer as dias_g_ciclo
 from ciclos c left join public.chamada_diaria cd on cd.colaborador_id=c.colaborador_id and cd.data>=c.aplica_a_partir_de and (c.proxima_baseline is null or cd.data<c.proxima_baseline)
 group by c.id,c.colaborador_id,c.data_medicao,c.aplica_a_partir_de,c.jornada_horas_dia,c.saldo_minutos,c.origem,c.lote_importacao_id,c.created_at,c.proxima_baseline
)
select calculados.*,case when saldo_dias>0 then greatest(saldo_dias-dias_g_ciclo,0) else 0 end as dias_pendentes_compensar,
 case when saldo_dias<0 then abs(saldo_dias) else 0 end as dias_repor,
 case when saldo_dias<0 then 'A_REPOR' when saldo_dias>0 and greatest(saldo_dias-dias_g_ciclo,0)>0 then 'A_COMPENSAR' else 'EM_DIA' end as situacao_banco from calculados;

do $$ declare signature text; old_text text; definition text; begin
 for signature,old_text in select * from(values
  ('private.banco_horas_no_dia(uuid,date)','where m.colaborador_id = p_colaborador_id'),
  ('private.ler_quadro_atual_impl()','where med.colaborador_id = c.id')) as x(signature,old_text)
 loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'BANK_READ_DEFINITION_CHANGED: %',signature; end if;
  execute replace(definition,old_text,old_text||case when signature like '%banco_horas_no_dia%' then ' and m.cancelled_at is null' else ' and med.cancelled_at is null' end);
 end loop;
end $$;

-- The worker locks jobs before revision. Prepare every affected persisted result or
-- attendance decision before touching measurement/revision rows in the RPC.
create function private.time_bank_prepare_reprocess(p_employee uuid,p_start date) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.monitoring_enqueue(p_employee,p_start,null,null);
 insert into public.monitoring_jobs(employee_id,operational_date,reason)
 select p_employee,d,'Revisao de medicao do Banco de Horas' from (
  select operational_date d from public.monitoring_results where active and employee_id=p_employee and operational_date>=p_start
  union select operational_date from private.daily_call_decisions where employee_id=p_employee and operational_date>=p_start
 ) affected order by d
 on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
end $$;
revoke all on function private.time_bank_prepare_reprocess(uuid,date) from public,anon,authenticated,service_role;

create or replace function private.daily_call_baseline_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare employee uuid; start_date date;
begin
 employee:=coalesce(new.colaborador_id,old.colaborador_id);
 start_date:=least(new.aplica_a_partir_de,old.aplica_a_partir_de);
 perform private.time_bank_prepare_reprocess(employee,start_date);
 update private.monitoring_revision set version=version+1 where id=true;
 update public.monitoring_results set dirty=true where active and employee_id=employee and operational_date>=start_date;
 update private.daily_call_revision set version=version+1 where id=true;
 delete from private.daily_call_closures where manager_key=coalesce((select gestor_id::text from public.colaboradores where id=employee),'none') and operational_date>=start_date;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;

create function private.time_bank_measurement_row(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',m.id,'employeeId',c.id,'employeeName',c.nome,'employeeNumber',c.matricula,'unit',u.codigo,
 'measurementDate',m.data_medicao,'effectiveFrom',m.aplica_a_partir_de,'workdayHours',m.jornada_horas_dia,'balanceMinutes',m.saldo_minutos,
 'source',m.origem,'importBatchId',m.lote_importacao_id,'createdAt',m.created_at,'updatedAt',m.updated_at,'cancelledAt',m.cancelled_at)
 from public.banco_horas_medicoes m join public.colaboradores c on c.id=m.colaborador_id join public.unidades u on u.id=c.unidade_id where m.id=p_id
$$;
revoke all on function private.time_bank_measurement_row(uuid) from public,anon,authenticated,service_role;

create function private.time_bank_admin_impl(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); target public.banco_horas_medicoes; employee uuid; item uuid; expected timestamptz;
 before_value jsonb;after_value jsonb;rows jsonb;options jsonb;total bigint;reason text:=btrim(p_data->>'reason');
 measured date;effective date;hours numeric;balance integer;source text;start_date date;queued bigint;
 page_limit integer:=coalesce((p_data->>'limit')::integer,100);page_offset integer:=coalesce((p_data->>'offset')::integer,0);state text:=coalesce(p_data->>'state','active');
begin
 if not exists(select 1 from public.perfis where id=actor and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH')) then raise exception using errcode='42501',message='BANK_ADMIN_FORBIDDEN'; end if;
 if p_action='list' then
  if page_limit not between 1 and 200 or page_offset not between 0 and 100000 or state not in ('active','cancelled','all') or length(coalesce(p_data->>'query',''))>100 then raise exception 'BANK_ADMIN_INVALID'; end if;
  with filtered as materialized (
   select m.id,c.nome,c.matricula,m.aplica_a_partir_de from public.banco_horas_medicoes m join public.colaboradores c on c.id=m.colaborador_id
   where (state='all' or (state='active' and m.cancelled_at is null) or (state='cancelled' and m.cancelled_at is not null))
    and (nullif(p_data->>'employeeId','') is null or m.colaborador_id=(p_data->>'employeeId')::uuid)
    and (coalesce(p_data->>'query','')='' or c.nome ilike '%'||(p_data->>'query')||'%' or c.matricula ilike '%'||(p_data->>'query')||'%')
  ),page as(select * from filtered order by nome,matricula,aplica_a_partir_de desc,id limit page_limit offset page_offset)
  select (select count(*) from filtered),(select coalesce(jsonb_agg(private.time_bank_measurement_row(id) order by nome,matricula,aplica_a_partir_de desc,id),'[]') from page) into total,rows;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.nome,'employeeNumber',c.matricula,'unit',u.codigo,'active',c.ativo_no_sistema) order by c.nome,c.matricula),'[]') into options from public.colaboradores c join public.unidades u on u.id=c.unidade_id;
  return jsonb_build_object('rows',rows,'total',total,'employees',options);
 elsif p_action='history' then
  item:=(p_data->>'id')::uuid;
  if not exists(select 1 from public.banco_horas_medicoes where id=item) then raise exception 'BANK_ADMIN_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'action',a.action,'reason',a.reason,'actorName',p.nome_completo,'createdAt',a.created_at,'before',a.before_record,'after',a.after_record) order by a.id desc),'[]') into rows
  from private.time_bank_measurement_audit a join public.perfis p on p.id=a.actor where a.measurement_id=item;
  return jsonb_build_object('rows',rows);
 elsif p_action is null or p_action not in ('save','cancel','restore') then raise exception 'BANK_ADMIN_INVALID'; end if;
 if coalesce(length(reason),0) not between 5 and 1000 then raise exception 'BANK_ADMIN_INVALID'; end if;
 perform 1 from public.perfis where id=actor and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH') for share;
 if not found then raise exception using errcode='42501',message='BANK_ADMIN_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(791803);
 item:=(p_data->>'id')::uuid;expected:=(p_data->>'expectedUpdatedAt')::timestamptz;
 if item is not null then
  select * into target from public.banco_horas_medicoes where id=item;
  if not found then raise exception 'BANK_ADMIN_NOT_FOUND'; end if;
  if expected is null or target.updated_at is distinct from expected then raise exception 'BANK_ADMIN_STALE'; end if;
  employee:=target.colaborador_id;before_value:=private.time_bank_measurement_row(item);
 elsif p_action<>'save' or expected is not null then raise exception 'BANK_ADMIN_INVALID'; end if;
 if p_action='save' then
  if target.cancelled_at is not null then raise exception 'BANK_ADMIN_CANCELLED'; end if;
  if item is not null and employee is distinct from (p_data->>'employeeId')::uuid then raise exception 'BANK_ADMIN_EMPLOYEE_IMMUTABLE'; end if;
  employee:=(p_data->>'employeeId')::uuid;measured:=(p_data->>'measurementDate')::date;effective:=(p_data->>'effectiveFrom')::date;
  hours:=(p_data->>'workdayHours')::numeric;balance:=(p_data->>'balanceMinutes')::integer;source:=nullif(btrim(p_data->>'source'),'');
  if employee is null or not exists(select 1 from public.colaboradores where id=employee) or measured is null or effective is null or not isfinite(measured) or not isfinite(effective)
   or hours is null or hours<=0 or hours>24 or round(hours*60)<1 or scale(hours)>4 or balance is null or balance not between -10000000 and 10000000 or length(source)>200 then raise exception 'BANK_ADMIN_INVALID'; end if;
 elsif (p_action='cancel' and target.cancelled_at is not null) or (p_action='restore' and target.cancelled_at is null) then raise exception 'BANK_ADMIN_STALE';
 end if;
 start_date:=least(target.aplica_a_partir_de,effective);
 perform private.time_bank_prepare_reprocess(employee,start_date);
 perform 1 from private.monitoring_revision where id=true for update;
 if item is not null then
  select * into target from public.banco_horas_medicoes where id=item for update;
  if target.updated_at is distinct from expected then raise exception 'BANK_ADMIN_STALE'; end if;
 end if;
 if p_action='save' then
  if item is null then
   insert into public.banco_horas_medicoes(colaborador_id,data_medicao,aplica_a_partir_de,jornada_horas_dia,saldo_minutos,origem,created_by,updated_by)
   values(employee,measured,effective,hours,balance,source,actor,actor) returning id into item;
  else update public.banco_horas_medicoes set data_medicao=measured,aplica_a_partir_de=effective,jornada_horas_dia=hours,saldo_minutos=balance,origem=source,updated_by=actor where id=item; end if;
 elsif p_action='cancel' then update public.banco_horas_medicoes set cancelled_at=clock_timestamp(),cancelled_by=actor,updated_by=actor where id=item;
 else update public.banco_horas_medicoes set cancelled_at=null,cancelled_by=null,updated_by=actor where id=item; end if;
 after_value:=private.time_bank_measurement_row(item);
 insert into private.time_bank_measurement_audit(measurement_id,actor,action,reason,before_record,after_record)
 values(item,actor,case when p_action='save' then case when before_value is null then 'create' else 'update' end else p_action end,reason,before_value,after_value);
 select count(*) into queued from public.monitoring_jobs where employee_id=employee and operational_date>=start_date;
 return jsonb_build_object('record',after_value,'queued',queued,'changed',true);
exception
 when unique_violation then raise exception 'BANK_ADMIN_BASELINE_CONFLICT';
 when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or not_null_violation or check_violation then raise exception 'BANK_ADMIN_INVALID';
end $$;
revoke all on function private.time_bank_admin_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.time_bank_admin_impl(text,jsonb) to authenticated;
create function public.time_bank_admin(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.time_bank_admin_impl(p_action,p_data)$$;
revoke all on function public.time_bank_admin(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.time_bank_admin(text,jsonb) to authenticated;
