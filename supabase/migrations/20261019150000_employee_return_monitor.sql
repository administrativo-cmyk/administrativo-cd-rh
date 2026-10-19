-- The database scheduler keeps this independent from a workstation or an open browser.
create table private.employee_lifecycle_checks(employee_id uuid primary key references public.colaboradores(id),evaluated_at timestamptz not null);
alter table private.employee_lifecycle_checks enable row level security;
revoke all on private.employee_lifecycle_checks from public,anon,authenticated,service_role;
create function private.employee_return_evidence(p_employee uuid,p_since date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare day date;decision jsonb;first_day date;normal_days integer:=0;proof jsonb:='[]';today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if p_since is null or p_since>today then return jsonb_build_object('firstDate',null,'normalDays',0,'punchIds','[]'::jsonb);end if;
 -- Candidate dates come only from this employee's exact typed and namespaced AFD bindings.
 -- Both dates are tested by the established night attribution engine, never by calendar grouping.
 for day in with candidates as materialized (
  select distinct (e.occurred_at at time zone s.timezone)::date as calendar_date
  from public.monitoring_events e join public.monitoring_sources s on s.id=e.source_id
  where e.event_type='punch' and e.eligible and not e.conflicted and e.classification='authorized'
  and e.occurred_at>=p_since::timestamp at time zone 'America/Sao_Paulo' and e.occurred_at<=now()
  and s.kind='afd' and s.configuration->>'sourceIdentityConfirmed'='true'
  and exists(select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
   where b.employee_id=p_employee and bs.identity_namespace=s.identity_namespace and b.identity_type=e.identity_type and b.identity_value=e.identity_value
   and b.revoked_at is null and b.valid_from<=(e.occurred_at at time zone s.timezone)::date and (b.valid_to is null or b.valid_to>=(e.occurred_at at time zone s.timezone)::date))
 ), dates as (select calendar_date d from candidates union select calendar_date-1 from candidates)
 select d from dates where d>=p_since and d<=today order by d loop
  decision:=private.daily_call_evidence(p_employee,day);
  if decision->>'status'='P' and decision->>'scheduleId' is not null then
   first_day:=coalesce(first_day,day);
   if day>=today-7 and jsonb_array_length(decision->'punchIds')>=2 then normal_days:=normal_days+1;end if;
   if jsonb_array_length(proof)=0 then proof:=decision->'punchIds';end if;
  end if;
 end loop;
 return jsonb_build_object('firstDate',first_day,'normalDays',normal_days,'punchIds',proof);
end $$;

create function private.employee_lifecycle_tick() returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.colaboradores;signal jsonb;return_proof jsonb;kind text;returned integer:=0;checked integer:=0;
 today date:=(now() at time zone 'America/Sao_Paulo')::date;before_row jsonb;returns jsonb:='[]';candidate jsonb;employee uuid;
begin
 -- Gather first, enqueue ALL jobs next, then lock revisions and employee rows. Holding
 -- a revision while acquiring another employee's job could deadlock with a worker.
 if not pg_try_advisory_xact_lock(824202609,1) then return jsonb_build_object('busy',true,'checked',0,'returned',0);end if;
 perform pg_advisory_xact_lock(791800,1);perform pg_advisory_xact_lock(791701);
 for c in select * from public.colaboradores where ativo_no_sistema and private.employee_is_away(situacao::text)
 order by coalesce((select evaluated_at from private.employee_lifecycle_checks s where s.employee_id=colaboradores.id),'-infinity'::timestamptz),id limit 25 loop
  checked:=checked+1;kind:=null;return_proof:=null;
  insert into private.employee_lifecycle_checks(employee_id,evaluated_at) values(c.id,clock_timestamp()) on conflict(employee_id) do update set evaluated_at=excluded.evaluated_at;
  if c.situacao_desde is null or c.retorno_previsto is null then
   -- Recent recurrence may invite human review even for an incomplete legacy record.
   -- It cannot establish the effective return date or authorize automatic activation.
   signal:=private.employee_return_evidence(c.id,greatest(coalesce(c.situacao_desde,today-7),today-7));
   kind:=case when (signal->>'normalDays')::integer>=2 then 'return_suggested' else 'dates_missing' end;
  else
   signal:=private.employee_return_evidence(c.id,greatest(c.situacao_desde,today-7));
   if c.retorno_previsto<=today then return_proof:=private.employee_return_evidence(c.id,greatest(c.situacao_desde,c.retorno_previsto));end if;
   if return_proof->>'firstDate' is not null then
    returns:=returns||jsonb_build_array(jsonb_build_object('employeeId',c.id,'version',c.updated_at,'proof',return_proof));continue;
   elsif (signal->>'normalDays')::integer>=2 then kind:='return_suggested';
   elsif c.retorno_previsto<today then kind:='return_overdue';end if;
  end if;
  if kind is not null then insert into private.employee_lifecycle_signals(employee_id,kind,evidence,employee_version) values(c.id,kind,signal,c.updated_at)
   on conflict(employee_id) do update set kind=excluded.kind,evidence=excluded.evidence,employee_version=excluded.employee_version,evaluated_at=clock_timestamp();
  else delete from private.employee_lifecycle_signals where employee_id=c.id;end if;
 end loop;
 for candidate in select x from jsonb_array_elements(returns) x order by x->>'employeeId' loop
  employee:=(candidate->>'employeeId')::uuid;perform private.monitoring_enqueue(employee,null,null,null);
  insert into public.monitoring_jobs(employee_id,operational_date,reason) select employee_id,operational_date,'Retorno confirmado pelo ponto' from public.monitoring_results where active and employee_id=employee order by operational_date
   on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
 end loop;
 if jsonb_array_length(returns)>0 then perform 1 from private.monitoring_revision where id=true for update;end if;
 for candidate in select x from jsonb_array_elements(returns) x order by x->>'employeeId' loop
  select * into c from public.colaboradores where id=(candidate->>'employeeId')::uuid and updated_at=(candidate->>'version')::timestamptz for update;
  if not found then continue;end if;
  return_proof:=candidate->'proof';
  before_row:=jsonb_build_object('situation',c.situacao,'situationFrom',c.situacao_desde,'expectedReturnDate',c.retorno_previsto);
  update private.employee_absence_periods set actual_return=(return_proof->>'firstDate')::date,updated_at=clock_timestamp() where employee_id=c.id and actual_return is null;
  if not found then insert into private.employee_absence_periods(employee_id,situation,start_date,expected_return,actual_return) values(c.id,c.situacao,c.situacao_desde,c.retorno_previsto,(return_proof->>'firstDate')::date);end if;
  update public.colaboradores set situacao='ATIVO',situacao_desde=(return_proof->>'firstDate')::date,retorno_previsto=null where id=c.id;
  insert into private.employee_lifecycle_audit(employee_id,action,reason,before_record,after_record,evidence) values(c.id,'automatic_return','Retorno previsto confirmado por batida AFD vinculada e atribuída ao turno',before_row,jsonb_build_object('situation','ATIVO','situationFrom',return_proof->>'firstDate'),return_proof);
  update public.monitoring_results set dirty=true where employee_id=c.id and active;
  delete from private.employee_lifecycle_signals where employee_id=c.id;returned:=returned+1;
 end loop;
 if returned>0 then update private.monitoring_revision set version=version+1 where id=true;update private.daily_call_revision set version=version+1 where id=true;end if;
 delete from private.employee_lifecycle_signals s using public.colaboradores person where person.id=s.employee_id and (not person.ativo_no_sistema or not private.employee_is_away(person.situacao::text));
 return jsonb_build_object('checked',checked,'returned',returned,'busy',false);
end $$;

alter function private.workspace_notifications(uuid,public.papel_usuario,uuid) rename to workspace_notifications_before_lifecycle;
create function private.workspace_notifications(p_actor uuid,p_role public.papel_usuario,p_manager uuid)
returns table(key text,title text,body text,href text,created_at timestamptz) language sql stable security definer set search_path='' as $$
 select * from private.workspace_notifications_before_lifecycle(p_actor,p_role,p_manager)
 union all
 select 'notice:employee-return:'||c.id::text||':'||c.updated_at::text||':'||s.kind,
 case s.kind when 'return_suggested' then 'Ponto indica possível retorno' when 'return_overdue' then 'RH: revise o retorno previsto' else 'Complete as datas do afastamento' end,
 c.nome||' — '||case s.kind when 'return_suggested' then 'Batidas recorrentes durante o afastamento. Confira e atualize a situação para Ativo se o retorno estiver confirmado.' when 'return_overdue' then 'Retorno previsto em '||to_char(c.retorno_previsto,'DD/MM/YYYY')||' sem confirmação pelo ponto. Atualize a previsão; o afastamento continua protegido de falta automática.' else 'Informe o início da situação e o retorno previsto. Não há reativação nem falta automática por data presumida.' end,
 '/administracao/colaboradores',c.updated_at
 from private.employee_lifecycle_signals s join public.colaboradores c on c.id=s.employee_id and c.updated_at=s.employee_version
 where p_role in ('ADMIN','RH') and c.ativo_no_sistema and private.employee_is_away(c.situacao::text)
 union all
 select 'notice:employee-reactivated:'||a.id::text,'Retorno confirmado pelo ponto',c.nome||' — situação alterada automaticamente para Ativo a partir de '||to_char((a.after_record->>'situationFrom')::date,'DD/MM/YYYY')||'. Histórico do afastamento preservado.',
 '/administracao/colaboradores',a.created_at from private.employee_lifecycle_audit a join public.colaboradores c on c.id=a.employee_id
 where p_role in ('ADMIN','RH') and a.action='automatic_return' and a.created_at>now()-interval '30 days'
$$;
revoke all on function private.employee_return_evidence(uuid,date),private.employee_lifecycle_tick(),private.workspace_notifications_before_lifecycle(uuid,public.papel_usuario,uuid),private.workspace_notifications(uuid,public.papel_usuario,uuid) from public,anon,authenticated,service_role;
-- No extension is installed by this migration. Hosted projects already running pg_cron
-- activate this single private task; isolated test databases safely skip scheduling.
do $cron$
begin
 if to_regclass('cron.job') is not null then
  if not exists(select 1 from cron.job where jobname='employee-lifecycle-monitor') then perform cron.schedule('employee-lifecycle-monitor','* * * * *','select private.employee_lifecycle_tick()');end if;
 end if;
end $cron$;
