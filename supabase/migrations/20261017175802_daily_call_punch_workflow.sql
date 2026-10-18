-- Daily Call keeps its existing status codes. I = absence; F remains day off.
-- Imported attendance never overwrites a manual entry or a manual clear.
alter table public.chamada_diaria add column origin text not null default 'manual'
  check (origin in ('manual','punch','automatic_absence'));

create table private.daily_call_revision(id boolean primary key default true check(id), version bigint not null default 1);
insert into private.daily_call_revision default values;
create table private.daily_call_decisions (
 employee_id uuid not null references public.colaboradores, operational_date date not null check(isfinite(operational_date)),
 version bigint not null default 1, input_version bigint, decision jsonb not null default '{}',
 manual_override boolean not null default false, updated_at timestamptz not null default clock_timestamp(),
 primary key(employee_id,operational_date)
);
create table private.daily_call_audit (
 id bigint generated always as identity primary key, employee_id uuid references public.colaboradores,
 operational_date date not null, action text not null, before_value jsonb, after_value jsonb,
 reason text not null, actor uuid references auth.users, created_at timestamptz not null default clock_timestamp()
);
create table private.daily_call_closures (
 operational_date date not null check(isfinite(operational_date)), manager_key text not null,
 revision bigint not null, input_version bigint not null, fingerprint text not null, reason text not null, actor uuid not null references auth.users,
 closed_at timestamptz not null default clock_timestamp(), primary key(operational_date,manager_key)
);
alter table private.daily_call_revision enable row level security;
alter table private.daily_call_decisions enable row level security;
alter table private.daily_call_audit enable row level security;
alter table private.daily_call_closures enable row level security;
revoke all on private.daily_call_revision,private.daily_call_decisions,private.daily_call_audit,private.daily_call_closures from public,anon,authenticated;

create function private.daily_call_change() returns trigger language plpgsql security definer set search_path='' as $$
declare v_employee uuid; v_date date;
begin
 if tg_when='BEFORE' then
   if auth.uid() is not null then new.origin:='manual'; end if;
   return new;
 end if;
 v_employee:=coalesce(new.colaborador_id,old.colaborador_id); v_date:=coalesce(new.data,old.data);
 if auth.uid() is not null and (new.status='G' or old.status='G') then
   perform private.monitoring_enqueue(v_employee,v_date+1,null,null);
 end if;
 update private.daily_call_revision set version=version+1;
 delete from private.daily_call_closures where operational_date=v_date and manager_key=coalesce((select gestor_id::text from public.colaboradores where id=v_employee),'none');
 if auth.uid() is not null then
   insert into private.daily_call_decisions(employee_id,operational_date,manual_override,decision)
   values(v_employee,v_date,true,jsonb_build_object('state',case when tg_op='DELETE' then 'pending_manager' else 'manual' end))
   on conflict(employee_id,operational_date) do update set manual_override=true,version=private.daily_call_decisions.version+1,
     decision=excluded.decision,updated_at=clock_timestamp();
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.daily_call_change() from public,anon,authenticated;
create trigger daily_call_manual_origin before insert or update on public.chamada_diaria for each row execute function private.daily_call_change();
create trigger daily_call_workflow_changed after insert or update or delete on public.chamada_diaria for each row execute function private.daily_call_change();

-- A proof is never inferred from the first/last timestamp in an imported file.
-- continuous coverage is an explicit source declaration, with a completed import
-- after the shift end and no rejected/conflicted/incomplete source files.
create function private.daily_call_evidence(p_employee uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.colaboradores; sched public.monitoring_settings; n integer; d integer:=extract(dow from p_date);
 v_start timestamptz; v_end timestamptz; v_window_start timestamptz; v_window_end timestamptz;
 v_punches jsonb:='[]'; v_coverage jsonb:='[]'; v_blockers jsonb:='[]'; v_balance integer; v_used integer; v_measure uuid;
 v_state text:='blocked'; v_status text; v_expected boolean:=false; v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
 v_neighbor jsonb;v_prior_end timestamptz;v_next_start timestamptz;
begin
 select * into c from public.colaboradores where id=p_employee;
 if not found then raise exception using errcode='22023',message='Colaborador inexistente'; end if;
 if p_date is null or not isfinite(p_date) then raise exception using errcode='22023',message='Data invalida'; end if;
 if c.admissao is null then v_blockers:=v_blockers||'"ADMISSION_UNKNOWN"'::jsonb;
 elsif p_date<c.admissao then return jsonb_build_object('state','not_expected','status',null,'balanceMinutes',null,'blockers',jsonb_build_array('BEFORE_ADMISSION')); end if;
 if not c.ativo_no_sistema or c.situacao not in ('ATIVO','NOVO_ADMITIDO') then
   return jsonb_build_object('state','not_expected','status',null,'balanceMinutes',null,'blockers',jsonb_build_array('NOT_ACTIVE'));
 end if;
 select count(*) into n from public.monitoring_settings where kind='schedule' and target=p_employee::text and revoked_at is null
   and valid_from<=p_date and (valid_to is null or valid_to>=p_date);
 if n=1 then
   select * into sched from public.monitoring_settings where kind='schedule' and target=p_employee::text and revoked_at is null
     and valid_from<=p_date and (valid_to is null or valid_to>=p_date);
   v_expected:=coalesce(sched.payload->'days' @> to_jsonb(array[d]),false);
   v_start:=(p_date+(sched.payload->>'start')::time) at time zone 'America/Sao_Paulo';
   v_end:=(p_date+(sched.payload->>'end')::time) at time zone 'America/Sao_Paulo';
   if v_end<=v_start then v_end:=v_end+interval '1 day'; end if;
   -- Match the temporal engine: neighboring effective schedules define midpoint
   -- assignment boundaries; the current schedule supplies only a boundary fallback.
   select case when count(*)=1 then jsonb_agg(payload)->0 else sched.payload end into v_neighbor
     from public.monitoring_settings where kind='schedule' and target=p_employee::text and revoked_at is null
     and valid_from<=p_date-1 and (valid_to is null or valid_to>=p_date-1) and payload->'days' @> to_jsonb(array[extract(dow from p_date-1)::integer]);
   v_prior_end:=((p_date-1)+(v_neighbor->>'end')::time) at time zone 'America/Sao_Paulo';
   if (v_neighbor->>'end')::time<=(v_neighbor->>'start')::time then v_prior_end:=v_prior_end+interval '1 day'; end if;
   select case when count(*)=1 then jsonb_agg(payload)->0 else sched.payload end into v_neighbor
     from public.monitoring_settings where kind='schedule' and target=p_employee::text and revoked_at is null
     and valid_from<=p_date+1 and (valid_to is null or valid_to>=p_date+1) and payload->'days' @> to_jsonb(array[extract(dow from p_date+1)::integer]);
   v_next_start:=((p_date+1)+(v_neighbor->>'start')::time) at time zone 'America/Sao_Paulo';
   v_window_start:=v_prior_end+(v_start-v_prior_end)/2;
   v_window_end:=v_end+(v_next_start-v_end)/2;
   if v_prior_end>=v_start or v_next_start<=v_end then
     v_blockers:=v_blockers||'"SCHEDULE_OVERLAP"'::jsonb;
   end if;
 else
   v_blockers:=v_blockers||to_jsonb(case when n=0 then 'SCHEDULE_UNKNOWN' else 'SCHEDULE_CONFLICT' end);
   v_window_start:=p_date::timestamp at time zone 'America/Sao_Paulo';
   v_window_end:=(p_date+1)::timestamp at time zone 'America/Sao_Paulo';
 end if;
 select coalesce(jsonb_agg(e.id order by e.occurred_at,e.id),'[]') into v_punches
 from public.monitoring_events e join public.monitoring_sources s on s.id=e.source_id
 where e.event_type='punch' and e.eligible and not e.conflicted and e.classification='authorized'
 and e.occurred_at>=v_window_start and e.occurred_at<v_window_end and e.occurred_at<=now()
 and s.kind='afd' and s.configuration->>'sourceIdentityConfirmed'='true'
 and (select count(distinct b.employee_id) from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
   where bs.identity_namespace=s.identity_namespace and b.identity_type=e.identity_type and b.identity_value=e.identity_value and b.revoked_at is null
   and b.valid_from<=(e.occurred_at at time zone s.timezone)::date and (b.valid_to is null or b.valid_to>=(e.occurred_at at time zone s.timezone)::date))=1
 and exists(select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id where b.employee_id=p_employee and bs.identity_namespace=s.identity_namespace
   and b.identity_type=e.identity_type and b.identity_value=e.identity_value and b.revoked_at is null
   and b.valid_from<=(e.occurred_at at time zone s.timezone)::date and (b.valid_to is null or b.valid_to>=(e.occurred_at at time zone s.timezone)::date));
 select medicao_id,saldo_minutos,dias_g_ciclo into v_measure,v_balance,v_used from private.banco_horas_no_dia(p_employee,p_date);
 if jsonb_array_length(v_punches)>0 and p_date<=v_today and c.admissao is not null and not(v_blockers ? 'SCHEDULE_OVERLAP') then
   v_state:='present';v_status:='P';v_blockers:='[]';
 elsif p_date>=v_today or (v_end is not null and v_end>now()) then v_blockers:=v_blockers||'"DAY_OPEN"'::jsonb;
 elsif n=1 and not v_expected then v_state:='not_expected';v_blockers:='[]';
 else
   if n=1 then
     select coalesce(jsonb_agg(s.id order by s.id),'[]') into v_coverage from public.monitoring_sources s
     where s.kind='afd' and s.configuration->>'sourceIdentityConfirmed'='true'
       and s.configuration#>>'{declaredCoverage,continuous}'='true'
       and (s.configuration#>>'{declaredCoverage,from}')::timestamptz<=v_window_start
       and (s.configuration#>>'{declaredCoverage,to}')::timestamptz>=v_window_end
       and s.last_success_at>=v_window_end
       and exists(select 1 from public.monitoring_files f where f.source_id=s.id and f.status='complete' and f.completed_at>=v_window_end)
       and not exists(select 1 from public.monitoring_files f where f.source_id=s.id and (f.status<>'complete' or f.rejected_rows>0 or f.conflict_rows>0))
       and s.worker_state is distinct from 'error'
       and not exists(select 1 from public.monitoring_attempts a where a.source_id=s.id and not exists(
         select 1 from public.monitoring_files recovered where recovered.source_id=a.source_id and recovered.relative_path=a.relative_path
         and recovered.status='complete' and recovered.rejected_rows=0 and recovered.conflict_rows=0 and recovered.completed_at>=a.created_at))
       and exists(select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id where bs.identity_namespace=s.identity_namespace and b.employee_id=p_employee and b.identity_type in ('cpf','pis')
         and b.revoked_at is null and b.valid_from<=(v_window_start at time zone 'America/Sao_Paulo')::date
         and (b.valid_to is null or b.valid_to>=((v_window_end-interval '1 microsecond') at time zone 'America/Sao_Paulo')::date));
   end if;
   if jsonb_array_length(v_coverage)=0 or exists(select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
     join public.monitoring_sources s on s.identity_namespace=bs.identity_namespace
     where b.employee_id=p_employee and b.revoked_at is null and b.valid_from<=p_date and (b.valid_to is null or b.valid_to>=p_date)
     and b.identity_type in ('cpf','pis') and s.kind='afd' and not(v_coverage ? s.id))
     then v_blockers:=v_blockers||'"PUNCH_COVERAGE_UNCONFIRMED"'::jsonb; end if;
   if exists(select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
     join public.monitoring_sources os on os.identity_namespace=bs.identity_namespace join public.monitoring_bindings other on other.source_id=os.id
     and other.identity_type=b.identity_type and other.identity_value=b.identity_value and other.employee_id<>b.employee_id
     where b.employee_id=p_employee and b.revoked_at is null and other.revoked_at is null
     and b.valid_from<=p_date and (b.valid_to is null or b.valid_to>=p_date)
     and other.valid_from<=p_date and (other.valid_to is null or other.valid_to>=p_date))
     then v_blockers:=v_blockers||'"IDENTITY_BINDING_CONFLICT"'::jsonb; end if;
   if v_measure is null then v_blockers:=v_blockers||'"BALANCE_UNKNOWN"'::jsonb;
   elsif v_used>0 then v_blockers:=v_blockers||'"BALANCE_REQUIRES_RECONCILIATION"'::jsonb; end if;
   if jsonb_array_length(v_blockers)=0 then
     if v_balance>480 then v_state:='pending_manager'; else v_state:='automatic_absence';v_status:='I'; end if;
   end if;
 end if;
 return jsonb_build_object('state',v_state,'status',v_status,'balanceMinutes',v_balance,'blockers',v_blockers,
   'punchIds',v_punches,'coverageSourceIds',v_coverage,'scheduleId',sched.id,'expected',v_expected,
   'expectedStart',v_start,'expectedEnd',v_end,'measurementId',v_measure,'usedCompensationDays',coalesce(v_used,0));
end $$;
revoke all on function private.daily_call_evidence(uuid,date) from public,anon,authenticated;

create function private.daily_call_apply_import_impl(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_employee uuid:=(p_data->>'employeeId')::uuid; v_date date:=(p_data->>'date')::date;
 v_input bigint; v_old public.chamada_diaria; v_decision private.daily_call_decisions; v_next jsonb; v_changed boolean:=false;
 v_origin text; v_before jsonb; v_after jsonb; v_version bigint;
begin
 if v_employee is null or v_date is null or not isfinite(v_date) or not (p_data ? 'inputVersion') then raise exception using errcode='22023',message='Entrada invalida'; end if;
 select version into v_input from private.monitoring_revision for share;
 if (p_data->>'inputVersion')::bigint is distinct from v_input then raise exception using errcode='PT409',message='MONITORING_INPUT_CHANGED'; end if;
 perform pg_advisory_xact_lock(hashtext(v_employee::text),hashtext(v_date::text));
 perform 1 from public.colaboradores where id=v_employee for share;
 select * into v_old from public.chamada_diaria where colaborador_id=v_employee and data=v_date for update;
 select * into v_decision from private.daily_call_decisions where employee_id=v_employee and operational_date=v_date for update;
 v_next:=private.daily_call_evidence(v_employee,v_date);
 if v_old.origin='manual' or coalesce(v_decision.manual_override,false) or
   (v_old.id is null and exists(select 1 from public.chamada_diaria_auditoria where colaborador_id=v_employee and data=v_date and operacao='CLEAR')) then
   v_next:=v_next||jsonb_build_object('state',case when v_old.id is null then 'pending_manager' else 'manual' end,'status',v_old.status,'blockers','[]'::jsonb);
 else
   v_origin:=case v_next->>'status' when 'P' then 'punch' when 'I' then 'automatic_absence' end;
   v_before:=case when v_old.id is null then null else to_jsonb(v_old) end;
   if v_origin is not null then
     if v_old.id is null then
       insert into public.chamada_diaria(colaborador_id,data,status,origin) values(v_employee,v_date,(v_next->>'status')::public.codigo_chamada,v_origin);v_changed:=true;
     elsif v_old.status::text is distinct from v_next->>'status' or v_old.origin is distinct from v_origin then
       update public.chamada_diaria set status=(v_next->>'status')::public.codigo_chamada,origin=v_origin,observacao=null,updated_by=null where id=v_old.id;v_changed:=true;
     end if;
   elsif v_old.id is not null then
     -- Retract only automated decisions when their supporting evidence expires.
     delete from public.chamada_diaria where id=v_old.id;v_changed:=true;
   end if;
   if v_changed then
     select to_jsonb(cd) into v_after from public.chamada_diaria cd where colaborador_id=v_employee and data=v_date;
     insert into private.daily_call_audit(employee_id,operational_date,action,before_value,after_value,reason)
       values(v_employee,v_date,'IMPORT',v_before,v_after,'Ponto conciliado e evidencias vigentes');
   end if;
 end if;
 if v_decision.employee_id is null or v_decision.decision is distinct from v_next then
   insert into private.daily_call_decisions(employee_id,operational_date,input_version,decision) values(v_employee,v_date,v_input,v_next)
   on conflict(employee_id,operational_date) do update set input_version=excluded.input_version,decision=excluded.decision,
      version=private.daily_call_decisions.version+1,updated_at=clock_timestamp() returning version into v_version;
   update private.daily_call_revision set version=version+1;
   delete from private.daily_call_closures where operational_date=v_date and manager_key=coalesce((select gestor_id::text from public.colaboradores where id=v_employee),'none');
   insert into private.daily_call_audit(employee_id,operational_date,action,before_value,after_value,reason)
     values(v_employee,v_date,'DECISION',v_decision.decision,v_next,'Evidencias de ponto e saldo reavaliadas');
 else
   v_version:=v_decision.version;
   update private.daily_call_decisions set input_version=v_input where employee_id=v_employee and operational_date=v_date and input_version is distinct from v_input;
 end if;
 select * into v_old from public.chamada_diaria where colaborador_id=v_employee and data=v_date;
 return jsonb_build_object('changed',v_changed,'state',v_next->>'state','status',v_old.status,'origin',v_old.origin,'decisionVersion',v_version::text);
end $$;
revoke all on function private.daily_call_apply_import_impl(jsonb) from public,anon,authenticated;
grant execute on function private.daily_call_apply_import_impl(jsonb) to service_role;
create function public.daily_call_apply_import(p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.daily_call_apply_import_impl(p_data) $$;
revoke all on function public.daily_call_apply_import(jsonb) from public,anon,authenticated;
grant execute on function public.daily_call_apply_import(jsonb) to service_role;

-- Wrap the existing scoped read without changing its population or BH arithmetic.
alter function chamada_privada.ler_chamada_diaria_impl(date,date,date) rename to ler_chamada_diaria_before_punch;
create function chamada_privada.ler_chamada_diaria_impl(p_data date,p_inicio date,p_fim date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
 v_result:=chamada_privada.ler_chamada_diaria_before_punch(p_data,p_inicio,p_fim);
 return jsonb_set(v_result,'{employees}',coalesce((select jsonb_agg(e||jsonb_build_object('attendance',coalesce((select jsonb_agg(a||jsonb_build_object('origin',cd.origin) order by a->>'date')
   from jsonb_array_elements(e->'attendance') a left join public.chamada_diaria cd on cd.colaborador_id=(e->>'id')::uuid and cd.data=(a->>'date')::date),'[]'::jsonb)))
   from jsonb_array_elements(v_result->'employees') e),'[]'::jsonb));
end $$;
revoke all on function chamada_privada.ler_chamada_diaria_before_punch(date,date,date) from public,anon,authenticated;
revoke all on function chamada_privada.ler_chamada_diaria_impl(date,date,date) from public,anon,authenticated;
grant execute on function chamada_privada.ler_chamada_diaria_impl(date,date,date) to authenticated;
-- Rebind the SQL wrapper after renaming its previous implementation.
create or replace function public.ler_chamada_diaria(p_data date,p_inicio date,p_fim date) returns jsonb
language sql stable security invoker set search_path='' as $$ select chamada_privada.ler_chamada_diaria_impl(p_data,p_inicio,p_fim) $$;

-- Manual intent is protected through both the original editor and the new queue.
-- Its same-value shortcut must not leave an automatic row vulnerable to a replay.
alter function chamada_privada.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz) rename to salvar_chamada_before_punch;
revoke all on function chamada_privada.salvar_chamada_before_punch(uuid,date,public.codigo_chamada,text,timestamptz) from public,anon,authenticated;
create function chamada_privada.salvar_chamada_diaria(p_colaborador_id uuid,p_data date,p_status public.codigo_chamada,p_observacao text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;v_existing public.chamada_diaria;
begin
 v_result:=chamada_privada.salvar_chamada_before_punch(p_colaborador_id,p_data,p_status,p_observacao,p_expected_updated_at);
 if v_result->>'changed'='false' then
   select * into v_existing from public.chamada_diaria where colaborador_id=p_colaborador_id and data=p_data for update;
   if v_existing.id is not null and v_existing.origin<>'manual' then
     if p_expected_updated_at is null or v_existing.updated_at is distinct from p_expected_updated_at then raise exception using errcode='PT409',message='Lancamento alterado; atualize os dados'; end if;
     update public.chamada_diaria set origin='manual',updated_by=auth.uid() where id=v_existing.id returning * into v_existing;
     insert into private.daily_call_audit(employee_id,operational_date,action,after_value,reason,actor)
       values(p_colaborador_id,p_data,'MANUAL_CONFIRM',to_jsonb(v_existing),'Confirmacao manual do status importado',auth.uid());
     return jsonb_build_object('changed',true,'record',jsonb_build_object('date',v_existing.data,'status',v_existing.status,'observation',v_existing.observacao,'updatedAt',v_existing.updated_at));
   elsif v_existing.id is null and p_status is null then
     insert into private.daily_call_decisions(employee_id,operational_date,manual_override,decision)
       values(p_colaborador_id,p_data,true,'{"state":"pending_manager"}')
       on conflict(employee_id,operational_date) do update set manual_override=true,version=private.daily_call_decisions.version+1,
         decision=excluded.decision,updated_at=clock_timestamp() where not private.daily_call_decisions.manual_override;
     if found then
       update private.daily_call_revision set version=version+1;
       delete from private.daily_call_closures where operational_date=p_data and manager_key=coalesce((select gestor_id::text from public.colaboradores where id=p_colaborador_id),'none');
       insert into private.daily_call_audit(employee_id,operational_date,action,reason,actor) values(p_colaborador_id,p_data,'MANUAL_CLEAR','Limpeza manual mantida sem lancamento',auth.uid());
       return jsonb_build_object('changed',true,'record',null);
     end if;
   end if;
 end if;
 return v_result;
end $$;
revoke all on function chamada_privada.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz) from public,anon,authenticated;
grant execute on function chamada_privada.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz) to authenticated;
create or replace function public.salvar_chamada_diaria(p_colaborador_id uuid,p_data date,p_status public.codigo_chamada,p_observacao text,p_expected_updated_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$ select chamada_privada.salvar_chamada_diaria(p_colaborador_id,p_data,p_status,p_observacao,p_expected_updated_at) $$;

create function private.daily_call_rows(p_start date,p_end date,p_manager uuid,p_filter_manager boolean,p_role public.papel_usuario,p_actor_manager uuid)
returns setof jsonb language sql stable security definer set search_path='' as $$
 with evidence as materialized (
   select c.id,d::date as date,private.daily_call_evidence(c.id,d::date) as value
   from public.colaboradores c cross join generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d
   where c.ativo_no_sistema and c.situacao in ('ATIVO','FERIAS','NOVO_ADMITIDO')
   and (p_role<>'GESTOR' or (p_actor_manager is not null and c.gestor_id=p_actor_manager))
   and (not p_filter_manager or c.gestor_id is not distinct from p_manager)
 )
 select jsonb_build_object('employeeId',c.id,'name',c.nome,'employeeNumber',c.matricula,'managerId',c.gestor_id,'managerName',coalesce(g.nome,'Sem gestor'),
 'date',ev.date,'status',cd.status,'origin',cd.origin,'observation',cd.observacao,'updatedAt',cd.updated_at,'decisionVersion',coalesce(dec.version,0)::text,
 'balanceMinutes',ev.value->'balanceMinutes','state',case when cd.origin='manual' then 'manual'
   when cd.origin='punch' and ev.value->>'status'='P' then 'present'
   when cd.origin='automatic_absence' and ev.value->>'status'='I' then 'automatic_absence'
   when dec.manual_override then 'pending_manager'
   when cd.id is not null or ev.value->>'status' is not null then 'blocked' else ev.value->>'state' end,
 'blockers',case when cd.origin='manual' or dec.manual_override then '[]'::jsonb
   when (cd.status::text is distinct from ev.value->>'status') and (cd.id is not null or ev.value->>'status' is not null)
   then (ev.value->'blockers')||'"IMPORT_REPROCESS_PENDING"'::jsonb else ev.value->'blockers' end)
 from evidence ev join public.colaboradores c on c.id=ev.id
 left join public.gestores g on g.id=c.gestor_id
 left join public.chamada_diaria cd on cd.colaborador_id=c.id and cd.data=ev.date
 left join private.daily_call_decisions dec on dec.employee_id=c.id and dec.operational_date=ev.date
 order by ev.date desc,g.nome nulls last,c.nome,c.matricula
$$;
revoke all on function private.daily_call_rows(date,date,uuid,boolean,public.papel_usuario,uuid) from public,anon,authenticated;

create function private.daily_call_workflow_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_role public.papel_usuario;v_manager uuid;v_filter uuid;v_date date;v_start date;v_end date;
 v_limit integer:=50;v_offset integer:=0;v_revision text;v_rows jsonb;v_days jsonb;v_counts jsonb;v_output jsonb;
 v_employee uuid;v_decision bigint;v_reason text:=btrim(p_data->>'reason');v_current bigint;v_stamp timestamptz;v_closed timestamptz;v_fingerprint text;v_unresolved boolean;
begin
 select papel_usuario,gestor_id into v_role,v_manager from public.perfis where id=v_actor and status_usuario='APROVADO' for share;
 if v_actor is null or not found or v_role not in ('ADMIN','RH','GESTOR','LEITURA') then raise exception using errcode='42501',message='Acesso nao autorizado'; end if;
 if p_action<>'queue' and v_role='LEITURA' then raise exception using errcode='42501',message='Somente leitura'; end if;
 if p_action<>'queue' and (v_reason is null or length(v_reason)<5 or length(v_reason)>500) then raise exception using errcode='22023',message='Motivo obrigatorio (5 a 500 caracteres)'; end if;
 v_filter:=(p_data->>'managerId')::uuid;
 if p_action='queue' then
   v_start:=(p_data->>'start')::date;v_end:=(p_data->>'end')::date;
   v_limit:=coalesce((p_data->>'limit')::integer,50);v_offset:=coalesce((p_data->>'offset')::integer,0);
   if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_end<v_start or v_end-v_start>30 or v_limit<1 or v_limit>200 or v_offset<0 then
     raise exception using errcode='22023',message='Periodo ou paginacao invalida'; end if;
   select m.version::text||':'||r.version::text into v_revision from private.monitoring_revision m cross join private.daily_call_revision r;
   with scoped as materialized (select value from private.daily_call_rows(v_start,v_end,v_filter,p_data?'managerId',v_role,v_manager) value),
   paginated as (select value from scoped offset v_offset limit v_limit),
   days as (select value->>'date' as d,value->>'managerId' as manager_id,value->>'managerName' as manager_name,
     count(*) as total,count(*) filter(where value->>'state'='present') as present,count(*) filter(where value->>'state'='automatic_absence') as absent,
     count(*) filter(where value->>'state'='manual') as manual,count(*) filter(where value->>'state'='pending_manager') as pending,
     count(*) filter(where value->>'state'='blocked') as blocked,md5(string_agg(value::text,'|' order by value->>'employeeId')) as fingerprint
     from scoped group by value->>'date',value->>'managerId',value->>'managerName')
   select (select coalesce(jsonb_agg(value),'[]') from paginated),
    (select coalesce(jsonb_agg(jsonb_build_object('date',d,'managerId',manager_id,'managerName',manager_name,'total',total,'present',present,
       'automaticAbsence',absent,'manual',manual,'pending',pending,'blocked',blocked,'closedAt',cl.closed_at) order by d desc,manager_name nulls last),'[]')
     from days left join private.daily_call_closures cl on cl.operational_date=days.d::date and cl.manager_key=coalesce(days.manager_id,'none')
       and cl.fingerprint=days.fingerprint),
    (select jsonb_build_object('total',count(*),'present',count(*) filter(where value->>'state'='present'),
      'automaticAbsence',count(*) filter(where value->>'state'='automatic_absence'),'manual',count(*) filter(where value->>'state'='manual'),
      'pending',count(*) filter(where value->>'state'='pending_manager'),'blocked',count(*) filter(where value->>'state'='blocked')) from scoped)
   into v_rows,v_days,v_counts;
   return jsonb_build_object('revision',v_revision,'start',v_start,'end',v_end,'rows',v_rows,'days',v_days,'counts',v_counts);
 elsif p_action='resolve' then
   v_employee:=(p_data->>'employeeId')::uuid;v_date:=(p_data->>'date')::date;
   if v_employee is null or v_date is null or not isfinite(v_date) or not(p_data?'expectedUpdatedAt') or not(p_data?'expectedDecisionVersion') then raise exception using errcode='22023',message='Entrada invalida'; end if;
   if not private.monitoring_can_read(v_employee) then raise exception using errcode='42501',message='Colaborador fora do escopo'; end if;
   perform pg_advisory_xact_lock(hashtext(v_employee::text),hashtext(v_date::text));
   select version into v_decision from private.daily_call_decisions where employee_id=v_employee and operational_date=v_date for update;
   if coalesce(v_decision,0)::text is distinct from p_data->>'expectedDecisionVersion' then raise exception using errcode='PT409',message='Fila alterada; atualize a revisao'; end if;
   select updated_at into v_stamp from public.chamada_diaria where colaborador_id=v_employee and data=v_date for update;
   if v_stamp is distinct from (p_data->>'expectedUpdatedAt')::timestamptz then raise exception using errcode='PT409',message='Lancamento alterado; atualize a revisao'; end if;
   v_output:=chamada_privada.salvar_chamada_diaria(v_employee,v_date,(p_data->>'status')::public.codigo_chamada,p_data->>'observation',(p_data->>'expectedUpdatedAt')::timestamptz);
   if v_output->>'changed'='false' then
     update public.chamada_diaria set origin='manual' where colaborador_id=v_employee and data=v_date and origin<>'manual';
     if found then v_output:=jsonb_build_object('changed',true,'record',(select jsonb_build_object('date',data,'status',status,'observation',observacao,'updatedAt',updated_at) from public.chamada_diaria where colaborador_id=v_employee and data=v_date)); end if;
   end if;
   insert into private.daily_call_audit(employee_id,operational_date,action,after_value,reason,actor) values(v_employee,v_date,'RESOLVE',v_output,v_reason,v_actor);
   return v_output;
 elsif p_action='close' then
   v_date:=(p_data->>'date')::date;
   if v_date is null or not isfinite(v_date) or v_date>=(now() at time zone 'America/Sao_Paulo')::date or not(p_data?'managerId') then raise exception using errcode='22023',message='Somente dia encerrado e gestor explicito'; end if;
   if v_role='GESTOR' and (v_manager is null or v_filter is distinct from v_manager) then raise exception using errcode='42501',message='Equipe fora do escopo'; end if;
   perform 1 from private.monitoring_revision for share;
   select version into v_current from private.daily_call_revision for update;
   select version::text||':'||v_current::text into v_revision from private.monitoring_revision;
   if v_revision is distinct from p_data->>'expectedRevision' then raise exception using errcode='PT409',message='Fila alterada; atualize a revisao'; end if;
   select md5(string_agg(value::text,'|' order by value->>'employeeId')),bool_or(value->>'state' in ('blocked','pending_manager'))
     into v_fingerprint,v_unresolved from private.daily_call_rows(v_date,v_date,v_filter,true,v_role,v_manager) value;
   if coalesce(v_unresolved,true) then
     raise exception using errcode='22023',message='Resolva os colaboradores pendentes antes de encerrar'; end if;
   insert into private.daily_call_closures(operational_date,manager_key,revision,input_version,fingerprint,reason,actor)
     values(v_date,coalesce(v_filter::text,'none'),v_current,(select version from private.monitoring_revision),v_fingerprint,v_reason,v_actor)
     on conflict(operational_date,manager_key) do update set revision=excluded.revision,input_version=excluded.input_version,fingerprint=excluded.fingerprint,reason=excluded.reason,actor=excluded.actor,closed_at=clock_timestamp()
     returning closed_at into v_closed;
   insert into private.daily_call_audit(operational_date,action,after_value,reason,actor) values(v_date,'CLOSE',jsonb_build_object('managerId',v_filter,'revision',v_revision),v_reason,v_actor);
   return jsonb_build_object('closed',true,'date',v_date,'managerId',v_filter,'revision',v_revision,'closedAt',v_closed);
 else raise exception using errcode='22023',message='Acao desconhecida'; end if;
end $$;
revoke all on function private.daily_call_workflow_impl(text,jsonb) from public,anon,authenticated;
grant execute on function private.daily_call_workflow_impl(text,jsonb) to authenticated;
create function public.daily_call_workflow(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.daily_call_workflow_impl(p_action,p_data) $$;
revoke all on function public.daily_call_workflow(text,jsonb) from public,anon,authenticated;
grant execute on function public.daily_call_workflow(text,jsonb) to authenticated;

-- Finish and attendance commit together; an error preserves the retryable job.
alter function private.monitoring_save_result_impl(jsonb) rename to monitoring_save_result_before_attendance;
revoke all on function private.monitoring_save_result_before_attendance(jsonb) from public,anon,authenticated,service_role;
create function private.monitoring_save_result_impl(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;v_attendance jsonb;
begin
 v_result:=private.monitoring_save_result_before_attendance(p_data);
 v_attendance:=private.daily_call_apply_import_impl(jsonb_build_object('employeeId',p_data->'employeeId','date',p_data->'date','inputVersion',p_data->'version'));
 return v_result||jsonb_build_object('attendance',v_attendance);
end $$;
revoke all on function private.monitoring_save_result_impl(jsonb) from public,anon,authenticated;
grant execute on function private.monitoring_save_result_impl(jsonb) to service_role;
create or replace function public.monitoring_save_result(p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.monitoring_save_result_impl(p_data) $$;

-- Add expected days even when the source has zero punches for that employee.
-- Explicit coverage bounds cap the expansion; no first/last-punch inference.
alter function private.monitoring_enqueue(uuid,date,date,text) rename to monitoring_enqueue_before_attendance;
create function private.monitoring_enqueue(p_employee uuid default null,p_start date default null,p_end date default null,p_source text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.monitoring_enqueue_before_attendance(p_employee,p_start,p_end,p_source);
 insert into public.monitoring_jobs(employee_id,operational_date,reason)
 select distinct b.employee_id,d::date,'Revisao da Chamada por cobertura de ponto'
 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
 join public.monitoring_sources s on s.identity_namespace=bs.identity_namespace join public.colaboradores c on c.id=b.employee_id
 cross join lateral generate_series(
   greatest((s.configuration#>>'{declaredCoverage,from}')::timestamptz at time zone 'America/Sao_Paulo',b.valid_from::timestamp,c.admissao::timestamp,coalesce(p_start,'0001-01-01')::timestamp),
   least((s.configuration#>>'{declaredCoverage,to}')::timestamptz at time zone 'America/Sao_Paulo',coalesce(b.valid_to,'9999-12-31')::timestamp,coalesce(p_end,'9999-12-31')::timestamp,(now() at time zone 'America/Sao_Paulo')::date::timestamp),interval '1 day') d
 where b.revoked_at is null and b.identity_type in ('cpf','pis') and s.kind='afd' and s.configuration->>'sourceIdentityConfirmed'='true'
 and s.configuration#>>'{declaredCoverage,continuous}'='true' and c.ativo_no_sistema and c.admissao is not null
 and (p_employee is null or b.employee_id=p_employee) and (p_source is null or s.id=p_source)
 and exists(select 1 from public.monitoring_settings ms where ms.kind='schedule' and ms.target=b.employee_id::text and ms.revoked_at is null
   and ms.valid_from<=d::date and (ms.valid_to is null or ms.valid_to>=d::date) and ms.payload->'days' @> to_jsonb(array[extract(dow from d)::integer]))
 on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
end $$;
revoke all on function private.monitoring_enqueue(uuid,date,date,text) from public,anon,authenticated,service_role;

-- Source completion and baseline changes can make a formerly blocked day ready.
create function private.daily_call_source_ready() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='afd' and (new.last_success_at is distinct from old.last_success_at or new.configuration is distinct from old.configuration
   or coalesce(new.worker_state='error',false) is distinct from coalesce(old.worker_state='error',false)) then
   if coalesce(new.worker_state='error',false) is distinct from coalesce(old.worker_state='error',false) then update private.monitoring_revision set version=version+1; end if;
   update public.monitoring_results r set dirty=true where active and exists(select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
     where b.employee_id=r.employee_id and bs.identity_namespace=new.identity_namespace);
   perform private.monitoring_enqueue(null,null,null,new.id);
 end if;
 return new;
end $$;
revoke all on function private.daily_call_source_ready() from public,anon,authenticated;
create trigger daily_call_source_ready after update of last_success_at,configuration,worker_state on public.monitoring_sources for each row execute function private.daily_call_source_ready();

create function private.daily_call_source_failure() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update private.monitoring_revision set version=version+1;
 update public.monitoring_results r set dirty=true where active and exists(select 1 from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
   where b.employee_id=r.employee_id and bs.identity_namespace=(select identity_namespace from public.monitoring_sources where id=new.source_id));
 perform private.monitoring_enqueue(null,null,null,new.source_id);
 return new;
end $$;
revoke all on function private.daily_call_source_failure() from public,anon,authenticated;
create trigger daily_call_source_failure after insert on public.monitoring_attempts for each row execute function private.daily_call_source_failure();

create function private.daily_call_baseline_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare v_employee uuid;
begin
 v_employee:=coalesce(new.colaborador_id,old.colaborador_id);
 perform private.monitoring_enqueue(v_employee,null,null,null);
 update private.daily_call_revision set version=version+1;
 delete from private.daily_call_closures where manager_key=coalesce((select gestor_id::text from public.colaboradores where id=v_employee),'none')
   and operational_date>=least(new.aplica_a_partir_de,old.aplica_a_partir_de);
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.daily_call_baseline_changed() from public,anon,authenticated;
create trigger daily_call_baseline_changed after insert or update or delete on public.banco_horas_medicoes for each row execute function private.daily_call_baseline_changed();
