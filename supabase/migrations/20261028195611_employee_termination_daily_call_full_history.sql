-- Termination is lifecycle data, not a punch or a manual attendance decision.
-- Project it into the requested roster without creating one row per future day.
create function private.daily_call_termination_records(
  p_employee uuid,
  p_start date,
  p_end date,
  p_selected date
) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', days.day,
    'status', 'D',
    'origin', 'lifecycle',
    'observation', 'Desligado desde ' || to_char(c.desligamento, 'DD/MM/YYYY')
  ) order by days.day), '[]'::jsonb)
  from public.colaboradores c
  cross join lateral (
    select distinct candidate::date as day
    from (
      select d as candidate
      from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') d
      union all
      select p_selected::timestamp
    ) requested
    where candidate::date >= c.desligamento
  ) days
  where c.id=p_employee
    and c.situacao='DESLIGADO'
    and c.desligamento is not null
$$;

revoke all on function private.daily_call_termination_records(uuid,date,date,date)
from public,anon,authenticated,service_role;

-- Keep every terminated employee in an explicit DESLIGADO filter. In the
-- normal roster, retain the employee only while the selected payroll period
-- contains a real punch-derived attendance row.
create or replace function private.daily_call_read_impl(p_date date,p_start date,p_end date,p_situation text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();profile public.perfis;result jsonb;
begin
 select * into profile from public.perfis where id=actor and status_usuario='APROVADO';
 if actor is null or profile.papel_usuario is null or profile.papel_usuario not in ('ADMIN','RH','GESTOR','LEITURA') then raise exception using errcode='42501',message='Acesso nao autorizado a Chamada Diaria';end if;
 if p_date is null or p_start is null or p_end is null or not isfinite(p_date) or not isfinite(p_start) or not isfinite(p_end) or p_end<p_start or p_end-p_start>30
 or (p_situation is not null and not exists(select 1 from unnest(enum_range(null::public.situacao_colaborador)) x where x::text=p_situation)) then raise exception using errcode='22023',message='Intervalo ou situacao invalida';end if;
 select jsonb_build_object('date',p_date,'startDate',p_start,'endDate',p_end,'employees',coalesce(jsonb_agg(jsonb_build_object(
 'id',c.id,'employeeNumber',c.matricula,'additionalEmployeeNumbers',private.employee_additional_numbers(c.id),'name',c.nome,'unit',u.codigo,'department',c.setor,'role',c.funcao,'situation',c.situacao,
 'manager',g.nome,'admissionDate',c.admissao,'canWrite',coalesce((profile.papel_usuario in ('ADMIN','RH') or (profile.papel_usuario='GESTOR' and profile.gestor_id is not null and c.gestor_id=profile.gestor_id)),false),'terminationDate',c.desligamento,'expectedReturnDate',c.retorno_previsto,'activeInSystem',c.ativo_no_sistema,
 'pendingTerminationDates','[]'::jsonb,
 'measurementDate',b.data_medicao,'effectiveFrom',b.aplica_a_partir_de,'workdayHours',b.jornada_horas_dia,'balanceMinutes',b.saldo_minutos,'balanceDays',b.saldo_dias,
 'usedCompensationDays',coalesce(b.dias_g_ciclo,0),'pendingCompensationDays',b.dias_pendentes_compensar,'replacementDays',b.dias_repor,
 'attendance',coalesce(ch.records,'[]'::jsonb)
   ||private.daily_call_fixed_rest_records(c.id,p_start,p_end,p_date)
   ||private.daily_call_termination_records(c.id,p_start,p_end,p_date)) order by c.nome,c.matricula),'[]'::jsonb)) into result
 from public.colaboradores c join public.unidades u on u.id=c.unidade_id left join public.gestores g on g.id=c.gestor_id
 left join lateral private.banco_horas_no_dia(c.id,p_date) b on true
 left join lateral(
   select jsonb_agg(jsonb_build_object('date',cd.data,'status',cd.status,'observation',cd.observacao,'updatedAt',cd.updated_at,'origin',cd.origin) order by cd.data) records
   from public.chamada_diaria cd
   where cd.colaborador_id=c.id
     and (cd.data between p_start and p_end or cd.data=p_date)
     and (c.desligamento is null or c.situacao<>'DESLIGADO' or cd.data<c.desligamento)
 ) ch on true
 where (profile.papel_usuario<>'GESTOR' or profile.visualizar_todos_gestores or (profile.gestor_id is not null and c.gestor_id=profile.gestor_id))
 and case when p_situation is null then
   c.ativo_no_sistema and (
     c.situacao<>'DESLIGADO'
     or exists(select 1 from public.chamada_diaria punched where punched.colaborador_id=c.id and punched.origin='punch' and punched.data between p_start and p_end)
   )
 else c.situacao::text=p_situation and (c.ativo_no_sistema or p_situation='DESLIGADO') end;
 return result;
end $$;

revoke all on function private.daily_call_read_impl(date,date,date,text)
from public,anon,authenticated,service_role;
grant execute on function private.daily_call_read_impl(date,date,date,text) to authenticated;

-- A manual D is authoritative lifecycle input. Reuse the existing authorized
-- save path, then set termination date and preserve a dedicated audit record.
alter table private.employee_lifecycle_audit
  drop constraint employee_lifecycle_audit_action_check,
  add constraint employee_lifecycle_audit_action_check
    check(action in ('save','automatic_return','automatic_termination_from_daily_call'));

alter function chamada_privada.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)
rename to salvar_chamada_before_automatic_termination;

create function chamada_privada.salvar_chamada_diaria(
  p_colaborador_id uuid,
  p_data date,
  p_status public.codigo_chamada,
  p_observacao text,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;before_row jsonb;after_row jsonb;
begin
 result:=chamada_privada.salvar_chamada_before_automatic_termination(p_colaborador_id,p_data,p_status,p_observacao,p_expected_updated_at);
 if p_status='D' then
   select to_jsonb(c) into before_row from public.colaboradores c where c.id=p_colaborador_id for update;
   if before_row is null then raise exception 'Colaborador nao encontrado';end if;
   if before_row->>'situacao' is distinct from 'DESLIGADO' or (before_row->>'desligamento')::date is distinct from p_data then
     update public.colaboradores set
       situacao='DESLIGADO',
       desligamento=p_data,
       situacao_desde=p_data,
       retorno_previsto=null
     where id=p_colaborador_id
     returning to_jsonb(public.colaboradores.*) into after_row;
     insert into private.employee_lifecycle_audit(employee_id,actor,action,reason,before_record,after_record)
     values(p_colaborador_id,auth.uid(),'automatic_termination_from_daily_call','Data de desligamento definida pelo lançamento D na Chamada Diária',before_row,after_row);
     update private.monitoring_revision set version=version+1 where id=true;
     update private.daily_call_revision set version=version+1 where id=true;
     update public.monitoring_results set dirty=true where active and employee_id=p_colaborador_id and operational_date>=p_data;
   end if;
 end if;
 return result;
end $$;

revoke all on function chamada_privada.salvar_chamada_before_automatic_termination(uuid,date,public.codigo_chamada,text,timestamptz),
 chamada_privada.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)
from public,anon,authenticated,service_role;
grant execute on function chamada_privada.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz) to authenticated;

-- Storage is no longer constrained. Stop automatic retirement of operational
-- history. Existing private archives remain readable and recoverable.
update private.monitoring_archive_control
set active=false,maintenance=false,updated_at=clock_timestamp()
where id=true;
