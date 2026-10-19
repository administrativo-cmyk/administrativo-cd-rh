-- Only tracked working days can keep a terminated employee in the default roster.
create function private.employee_termination_pending(p_employee uuid) returns date[]
language plpgsql stable security definer set search_path='' as $$
declare c public.colaboradores; first_day date; last_day date; result date[];
begin
 select * into c from public.colaboradores where id=p_employee;
 if c.situacao<>'DESLIGADO' or c.desligamento is null or not c.ativo_no_sistema then return '{}'::date[];end if;
 select min((s.configuration#>>'{declaredCoverage,from}')::timestamptz at time zone 'America/Sao_Paulo')::date into first_day
 from public.monitoring_sources s where s.kind='afd' and s.configuration->>'sourceIdentityConfirmed'='true' and s.configuration#>>'{declaredCoverage,continuous}'='true';
 if first_day is null then select min(d) into first_day from (select data d from public.chamada_diaria where colaborador_id=p_employee union all select operational_date from public.monitoring_results where employee_id=p_employee and active) dates;end if;
 if first_day is null then return '{}'::date[];end if;
 first_day:=greatest(first_day,c.admissao);last_day:=least(c.desligamento,(now() at time zone 'America/Sao_Paulo')::date);
 select coalesce(array_agg(d::date order by d),'{}'::date[]) into result from generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d
 where not exists(select 1 from public.chamada_diaria cd where cd.colaborador_id=p_employee and cd.data=d::date)
 and not private.employee_absence_protected(p_employee,d::date)
 and private.calendar_resolution(p_employee,d::date)->>'state'<>'off'
 and (not exists(select 1 from private.schedule_window_rows(p_employee,d::date,d::date))
 or exists(select 1 from private.schedule_window_rows(p_employee,d::date,d::date) s where s.payload->>'weeklyRosterConfirmed'='false' or s.payload->'days' @> to_jsonb(array[extract(dow from d)::integer])));
 return result;
end $$;
create function private.employee_chamada_visible(p_employee uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select c.ativo_no_sistema and case when c.situacao<>'DESLIGADO' then true else c.desligamento>=(now() at time zone 'America/Sao_Paulo')::date or cardinality(private.employee_termination_pending(c.id))>0 end from public.colaboradores c where c.id=p_employee),false)
$$;

-- Keep the established night attribution, confirmed coverage and manual/CLEAR protections.
do $migration$
declare definition text;needle text;signature text;
begin
 definition:=pg_get_functiondef('private.daily_call_evidence_before_calendar(uuid,date)'::regprocedure);
 needle:='if not c.ativo_no_sistema or c.situacao not in (''ATIVO'',''NOVO_ADMITIDO'') then';
 if strpos(definition,needle)=0 then raise exception 'LIFECYCLE_EVIDENCE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,'if not private.employee_attendance_allowed(p_employee,p_date) then');
 needle:='elsif p_date>=v_today';
 if strpos(definition,needle)=0 then raise exception 'LIFECYCLE_ABSENCE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,'elsif private.employee_absence_protected(p_employee,p_date) then v_state:=''not_expected'';v_blockers:=jsonb_build_array(''EMPLOYEE_AWAY''); '||needle);
 execute definition;
 definition:=pg_get_functiondef('chamada_privada.salvar_chamada_before_punch(uuid,date,public.codigo_chamada,text,timestamptz)'::regprocedure);
 needle:='c.id = p_colaborador_id and c.ativo_no_sistema';
 if strpos(definition,needle)=0 then raise exception 'LIFECYCLE_MANUAL_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,'c.id = p_colaborador_id and private.employee_attendance_allowed(c.id,p_data)');
 definition:=replace(definition,'and c.situacao in (''ATIVO'', ''FERIAS'', ''NOVO_ADMITIDO'')','');execute definition;
 foreach signature in array array['private.daily_call_rows(date,date,uuid,boolean,public.papel_usuario,uuid)','private.daily_call_cached_rows(date,date,uuid,boolean,public.papel_usuario,uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);needle:='c.ativo_no_sistema and c.situacao in (''ATIVO'',''FERIAS'',''NOVO_ADMITIDO'')';
  if strpos(definition,needle)=0 then raise exception 'LIFECYCLE_QUEUE_DEFINITION_CHANGED';end if;
  definition:=replace(definition,'with evidence as materialized (','with roster as materialized (select id from public.colaboradores where private.employee_chamada_visible(id)), evidence as materialized (');
  definition:=replace(definition,'from public.colaboradores c cross join','from public.colaboradores c join roster on roster.id=c.id cross join');
  execute replace(definition,needle,'private.employee_attendance_allowed(c.id,d::date)');
 end loop;
 definition:=pg_get_functiondef('private.daily_call_batch_impl(text,jsonb)'::regprocedure);
 needle:='c.ativo_no_sistema and c.situacao in (''ATIVO'',''FERIAS'',''NOVO_ADMITIDO'') and (c.admissao is null or d>=c.admissao)';
 if strpos(definition,needle)=0 then raise exception 'LIFECYCLE_BATCH_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,'private.employee_attendance_allowed(c.id,d)');
 definition:=replace(definition,'not c.ativo_no_sistema or c.situacao not in (''ATIVO'',''FERIAS'',''NOVO_ADMITIDO'')','not private.employee_attendance_allowed(c.id,d)');execute definition;
 definition:=pg_get_functiondef('private.workspace_notifications(uuid,public.papel_usuario,uuid)'::regprocedure);
 needle:='c.ativo_no_sistema and c.situacao in (''ATIVO'',''FERIAS'',''NOVO_ADMITIDO'')';
 if strpos(definition,needle)=0 then raise exception 'LIFECYCLE_NOTIFICATION_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,'private.employee_attendance_allowed(c.id,d.operational_date) and not private.employee_absence_protected(c.id,d.operational_date)');
end $migration$;

create function private.daily_call_read_impl(p_date date,p_start date,p_end date,p_situation text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();profile public.perfis;result jsonb;
begin
 select * into profile from public.perfis where id=actor and status_usuario='APROVADO';
 if actor is null or profile.papel_usuario is null or profile.papel_usuario not in ('ADMIN','RH','GESTOR','LEITURA') then raise exception using errcode='42501',message='Acesso nao autorizado a Chamada Diaria';end if;
 if p_date is null or p_start is null or p_end is null or not isfinite(p_date) or not isfinite(p_start) or not isfinite(p_end) or p_end<p_start or p_end-p_start>30
 or (p_situation is not null and not exists(select 1 from unnest(enum_range(null::public.situacao_colaborador)) x where x::text=p_situation)) then raise exception using errcode='22023',message='Intervalo ou situacao invalida';end if;
 select jsonb_build_object('date',p_date,'startDate',p_start,'endDate',p_end,'employees',coalesce(jsonb_agg(jsonb_build_object(
 'id',c.id,'employeeNumber',c.matricula,'name',c.nome,'unit',u.codigo,'department',c.setor,'role',c.funcao,'situation',c.situacao,
 'manager',g.nome,'admissionDate',c.admissao,'terminationDate',c.desligamento,'expectedReturnDate',c.retorno_previsto,'activeInSystem',c.ativo_no_sistema,
 'pendingTerminationDates',case when c.situacao='DESLIGADO' then to_jsonb(private.employee_termination_pending(c.id)) else '[]'::jsonb end,
 'measurementDate',b.data_medicao,'effectiveFrom',b.aplica_a_partir_de,'workdayHours',b.jornada_horas_dia,'balanceMinutes',b.saldo_minutos,'balanceDays',b.saldo_dias,
 'usedCompensationDays',coalesce(b.dias_g_ciclo,0),'pendingCompensationDays',b.dias_pendentes_compensar,'replacementDays',b.dias_repor,
 'attendance',coalesce(ch.records,'[]'::jsonb)) order by c.nome,c.matricula),'[]'::jsonb)) into result
 from public.colaboradores c join public.unidades u on u.id=c.unidade_id left join public.gestores g on g.id=c.gestor_id
 left join lateral private.banco_horas_no_dia(c.id,p_date) b on true
 left join lateral(select jsonb_agg(jsonb_build_object('date',cd.data,'status',cd.status,'observation',cd.observacao,'updatedAt',cd.updated_at,'origin',cd.origin) order by cd.data) records from public.chamada_diaria cd where cd.colaborador_id=c.id and (cd.data between p_start and p_end or cd.data=p_date)) ch on true
 where (profile.papel_usuario<>'GESTOR' or (profile.gestor_id is not null and c.gestor_id=profile.gestor_id))
 and case when p_situation is null then private.employee_chamada_visible(c.id) else c.situacao::text=p_situation and (c.ativo_no_sistema or p_situation='DESLIGADO') end;
 return result;
end $$;
create function public.daily_call_read(p_date date,p_start date,p_end date,p_situation text default null) returns jsonb
language sql security invoker set search_path='' as $$select private.daily_call_read_impl(p_date,p_start,p_end,p_situation)$$;
-- Old clients get the same safe default population.
create or replace function chamada_privada.ler_chamada_diaria_impl(p_data date,p_inicio date,p_fim date) returns jsonb language sql stable security definer set search_path='' as $$select private.daily_call_read_impl(p_data,p_inicio,p_fim,null)$$;
revoke all on function private.employee_termination_pending(uuid),private.employee_chamada_visible(uuid),private.daily_call_read_impl(date,date,date,text),public.daily_call_read(date,date,date,text) from public,anon,authenticated,service_role;
grant execute on function private.daily_call_read_impl(date,date,date,text),public.daily_call_read(date,date,date,text) to authenticated;

-- Previously excluded statuses need fresh evidence; never replace manual decisions here.
do $refresh$
declare employee uuid;changed boolean:=false;
begin
 perform pg_advisory_xact_lock(824202609,1);perform pg_advisory_xact_lock(791800,1);perform pg_advisory_xact_lock(791701);
 for employee in select id from public.colaboradores where ativo_no_sistema and situacao not in ('ATIVO','NOVO_ADMITIDO') order by id loop
  changed:=true;perform private.monitoring_enqueue(employee,null,null,null);
  insert into public.monitoring_jobs(employee_id,operational_date,reason) select employee_id,operational_date,'Situação e datas do cadastro revisadas' from public.monitoring_results where employee_id=employee and active order by operational_date
   on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
 end loop;
 if changed then
  update private.monitoring_revision set version=version+1 where id=true;
  update private.daily_call_revision set version=version+1 where id=true;
  update public.monitoring_results r set dirty=true from public.colaboradores c where r.employee_id=c.id and c.ativo_no_sistema and c.situacao not in ('ATIVO','NOVO_ADMITIDO') and r.active;
 end if;
end $refresh$;
