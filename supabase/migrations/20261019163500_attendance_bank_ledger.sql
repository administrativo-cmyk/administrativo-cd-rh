create table private.attendance_punch_corrections (
 employee_id uuid not null references public.colaboradores,operational_date date not null,
 punches jsonb not null check(jsonb_typeof(punches)='array' and jsonb_array_length(punches)=4),
 reason text not null,updated_by uuid not null references public.perfis,updated_at timestamptz not null default clock_timestamp(),
 primary key(employee_id,operational_date)
);
create table private.attendance_bank_baselines (
 measurement_id uuid primary key references public.banco_horas_medicoes,
 activated_at timestamptz not null default clock_timestamp()
);
create index attendance_punch_corrections_author on private.attendance_punch_corrections(updated_by);
alter table private.attendance_punch_corrections enable row level security;
alter table private.attendance_bank_baselines enable row level security;
revoke all on private.attendance_punch_corrections,private.attendance_bank_baselines from public,anon,authenticated,service_role;

-- Existing official balances deliberately remain untouched. Future imported or
-- manually entered measurements start the clock ledger at their effective date.
create function private.attendance_bank_new_baseline() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into private.attendance_bank_baselines(measurement_id) values(new.id);
 return new;
end $$;
create trigger attendance_bank_new_baseline after insert on public.banco_horas_medicoes for each row execute function private.attendance_bank_new_baseline();
revoke all on function private.attendance_bank_new_baseline() from public,anon,authenticated,service_role;

alter function private.monitoring_input(uuid,date,date) rename to monitoring_input_before_bank;
create function private.monitoring_input(employee uuid,start_date date,end_date date) returns jsonb language sql stable security definer set search_path='' as $$
 select private.monitoring_input_before_bank(employee,start_date,end_date)||jsonb_build_object(
 'corrections',coalesce((select jsonb_agg(jsonb_build_object('date',operational_date,'punches',punches,'reason',reason,'updatedAt',updated_at))
 from private.attendance_punch_corrections where employee_id=employee and operational_date between start_date and end_date),'[]'::jsonb),
 'protectedDates',coalesce((select jsonb_agg(d::date) from generate_series(start_date::timestamp,end_date::timestamp,interval '1 day') d
 where not private.employee_attendance_allowed(employee,d::date) or private.employee_absence_protected(employee,d::date)),'[]'::jsonb))
$$;
revoke all on function private.monitoring_input(uuid,date,date),private.monitoring_input_before_bank(uuid,date,date) from public,anon,authenticated,service_role;

create function private.attendance_bank_delta(p_employee uuid,p_start date,p_end date) returns integer
language sql stable security definer set search_path='' as $$
 select coalesce(sum((r.summary#>>'{bankDay,deltaMinutes}')::integer),0)::integer
 from public.monitoring_results r where r.employee_id=p_employee and r.active and not r.dirty
 and r.operational_date between p_start and p_end and r.summary#>>'{bankDay,state}'='ready'
 and private.employee_attendance_allowed(p_employee,r.operational_date) and not private.employee_absence_protected(p_employee,r.operational_date)
 -- G is consumed once by the established compensation cycle, never as a punch deficit too.
 and not exists(select 1 from public.chamada_diaria c where c.colaborador_id=p_employee and c.data=r.operational_date and c.status='G')
$$;
revoke all on function private.attendance_bank_delta(uuid,date,date) from public,anon,authenticated,service_role;

-- One as-of calculator supplies Chamada and Banco de Horas; no historical baseline activation.
alter function private.banco_horas_no_dia(uuid,date) rename to banco_horas_no_dia_before_ledger;
create function private.banco_horas_no_dia(p_colaborador_id uuid,p_data date)
returns table(medicao_id uuid,data_medicao date,aplica_a_partir_de date,jornada_horas_dia numeric,saldo_minutos integer,saldo_dias integer,dias_g_ciclo integer,dias_pendentes_compensar integer,dias_repor integer)
language sql stable security invoker set search_path='' as $$
 with adjusted as (select b.*,b.saldo_minutos+case when exists(select 1 from private.attendance_bank_baselines a where a.measurement_id=b.medicao_id)
 then private.attendance_bank_delta(p_colaborador_id,b.aplica_a_partir_de,p_data) else 0 end balance
 from private.banco_horas_no_dia_before_ledger(p_colaborador_id,p_data) b), calculated as (
 select a.*,private.converter_saldo_minutos_em_dias(balance,jornada_horas_dia) days from adjusted a)
 select medicao_id,data_medicao,aplica_a_partir_de,jornada_horas_dia,balance,days,dias_g_ciclo,
 case when days>0 then greatest(days-dias_g_ciclo,0) else 0 end,case when days<0 then -days else 0 end from calculated
$$;
revoke all on function private.banco_horas_no_dia(uuid,date),private.banco_horas_no_dia_before_ledger(uuid,date) from public,anon,authenticated,service_role;

-- Keep the workforce card and security-invoker reporting views on the same balance.
create function private.attendance_bank_balance(p_measurement uuid,p_end date) returns integer
language plpgsql stable security definer set search_path='' as $$
declare m public.banco_horas_medicoes; actor uuid:=(select auth.uid());
begin
 select * into m from public.banco_horas_medicoes where id=p_measurement and cancelled_at is null;
 if not found then return null; end if;
 if (actor is null and current_setting('role',true) in ('anon','authenticated','service_role')) or
  (actor is not null and not private.monitoring_can_read(m.colaborador_id)) then raise exception using errcode='42501',message='ATTENDANCE_FORBIDDEN'; end if;
 return m.saldo_minutos+case when exists(select 1 from private.attendance_bank_baselines a where a.measurement_id=m.id)
 then private.attendance_bank_delta(m.colaborador_id,m.aplica_a_partir_de,least(p_end,(clock_timestamp() at time zone 'America/Sao_Paulo')::date)) else 0 end;
end $$;
revoke all on function private.attendance_bank_balance(uuid,date) from public,anon,authenticated,service_role;
grant execute on function private.attendance_bank_balance(uuid,date) to authenticated;
do $$declare definition text;needle text:='select med.id, med.data_medicao, med.jornada_horas_dia, med.saldo_minutos';begin
 definition:=pg_get_functiondef('private.ler_quadro_atual_impl()'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'WORKFORCE_BANK_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,'select med.id, med.data_medicao, med.jornada_horas_dia, private.attendance_bank_balance(med.id,(clock_timestamp() at time zone ''America/Sao_Paulo'')::date) as saldo_minutos');
end $$;
create or replace view public.vw_banco_horas_ciclos with(security_invoker=true) as
with measurements as (
 select m.*,lead(m.aplica_a_partir_de) over(partition by m.colaborador_id order by m.aplica_a_partir_de,m.data_medicao,m.created_at) next_date
 from public.banco_horas_medicoes m where m.cancelled_at is null
),ciclos as (
 select m.id,m.colaborador_id,m.data_medicao,m.aplica_a_partir_de,m.jornada_horas_dia,
 private.attendance_bank_balance(m.id,coalesce(m.next_date-1,(clock_timestamp() at time zone 'America/Sao_Paulo')::date)) saldo_minutos,
 m.origem,m.lote_importacao_id,m.created_at,m.next_date proxima_baseline from measurements m
),calculados as (
 select c.*,private.converter_saldo_minutos_em_dias(c.saldo_minutos,c.jornada_horas_dia) saldo_dias,
 count(cd.id) filter(where cd.status='G')::integer dias_g_ciclo from ciclos c
 left join public.chamada_diaria cd on cd.colaborador_id=c.colaborador_id and cd.data>=c.aplica_a_partir_de and (c.proxima_baseline is null or cd.data<c.proxima_baseline)
 group by c.id,c.colaborador_id,c.data_medicao,c.aplica_a_partir_de,c.jornada_horas_dia,c.saldo_minutos,c.origem,c.lote_importacao_id,c.created_at,c.proxima_baseline
)
select calculados.*,case when saldo_dias>0 then greatest(saldo_dias-dias_g_ciclo,0) else 0 end dias_pendentes_compensar,
 case when saldo_dias<0 then abs(saldo_dias) else 0 end dias_repor,
 case when saldo_dias<0 then 'A_REPOR' when saldo_dias>0 and greatest(saldo_dias-dias_g_ciclo,0)>0 then 'A_COMPENSAR' else 'EM_DIA' end situacao_banco from calculados;

create function private.attendance_history_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); role_name public.papel_usuario; employee uuid:=(p_data->>'employeeId')::uuid;
 start_date date:=(p_data->>'start')::date;end_date date:=(p_data->>'end')::date;day date; snapshot jsonb;before_record jsonb;after_record jsonb;
 existing private.attendance_punch_corrections; marks jsonb:=p_data->'punches';mark jsonb; at_time timestamptz;prev timestamptz;reason text:=btrim(p_data->>'reason');
begin
 select papel_usuario into role_name from public.perfis where id=actor and status_usuario='APROVADO' for share;
 if actor is null or role_name is null or not private.monitoring_can_read(employee) then raise exception using errcode='42501',message='ATTENDANCE_FORBIDDEN'; end if;
 if start_date is null or end_date is null or not isfinite(start_date) or not isfinite(end_date) or end_date<start_date or end_date-start_date>30 or end_date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception using errcode='22023',message='ATTENDANCE_INVALID_PERIOD'; end if;
 if p_action='history' then
  snapshot:=private.monitoring_input(employee,start_date,end_date);
  -- The history contract exposes only linked evidence needed for calculation.
  select coalesce(jsonb_agg(jsonb_set(jsonb_set(e,'{payload,identity}',case when e#>'{payload,identity}'='null'::jsonb then 'null'::jsonb else jsonb_build_object('type',e#>>'{payload,identity,type}','value','linked') end),
   '{payload,original}',jsonb_build_object('eventName',coalesce(e#>>'{payload,original,eventName}','')))),'[]'::jsonb) into marks from jsonb_array_elements(snapshot->'events') e;
  snapshot:=jsonb_set(snapshot,'{events}',marks);
  select coalesce(jsonb_agg(s),'[]'::jsonb) into marks from jsonb_array_elements(snapshot->'settings') s where s->>'target'=employee::text or s->>'kind' in ('mapping','coverage','rule','policy');
  snapshot:=jsonb_set(snapshot,'{settings}',marks);
  return jsonb_build_object('input',snapshot,'canEdit',role_name in ('ADMIN','RH'),
   'bank',(select to_jsonb(b)||jsonb_build_object('automatic',exists(select 1 from private.attendance_bank_baselines a where a.measurement_id=b.medicao_id),
    'movementMinutes',case when exists(select 1 from private.attendance_bank_baselines a where a.measurement_id=b.medicao_id) then private.attendance_bank_delta(employee,b.aplica_a_partir_de,end_date) else 0 end)
     from private.banco_horas_no_dia(employee,end_date) b),
   'correctionHistory',coalesce((select jsonb_agg(jsonb_build_object('date',detail->>'date','reason',detail->>'reason','at',created_at,'actorName',coalesce((select nome_completo from public.perfis where id=a.actor),'RH / ADMIN')) order by created_at desc)
    from public.monitoring_audit a where action='correct_punches' and detail->>'employeeId'=employee::text and (detail->>'date')::date between start_date and end_date),'[]'::jsonb));
 end if;
 if p_action<>'correct' or role_name not in ('ADMIN','RH') then raise exception using errcode='42501',message='ATTENDANCE_CORRECTION_FORBIDDEN'; end if;
 day:=(p_data->>'date')::date;
 if day is null or not isfinite(day) or day<start_date or day>end_date or length(reason) not between 5 and 1000 or jsonb_typeof(marks)<>'array' or jsonb_array_length(marks)<>4 then raise exception using errcode='22023',message='ATTENDANCE_INVALID_CORRECTION'; end if;
 snapshot:=private.monitoring_input(employee,day,day);
 for mark in select value from jsonb_array_elements(marks) loop
  at_time:=(mark->>'at')::timestamptz;
  if at_time is null or at_time<(day-1)::timestamp at time zone 'America/Sao_Paulo' or at_time>=(day+2)::timestamp at time zone 'America/Sao_Paulo' or at_time>clock_timestamp() or (prev is not null and at_time<=prev) then raise exception using errcode='22023',message='ATTENDANCE_INVALID_CORRECTION'; end if;
  if nullif(mark->>'evidenceId','') is not null and not exists(select 1 from jsonb_array_elements(snapshot->'events') e where e->>'id'=mark->>'evidenceId' and e->>'eligible'='true' and e->>'conflicted'='false' and e#>>'{payload,timestamp}' is not null and (e#>>'{payload,timestamp}')::timestamptz=at_time) then raise exception using errcode='22023',message='ATTENDANCE_INVALID_EVIDENCE'; end if;
  prev:=at_time;
 end loop;
 if prev-(marks->0->>'at')::timestamptz>interval '24 hours' then raise exception using errcode='22023',message='ATTENDANCE_INVALID_CORRECTION'; end if;
 perform pg_advisory_xact_lock(791704);
 perform private.time_bank_prepare_reprocess(employee,day);
 insert into public.monitoring_jobs(employee_id,operational_date,reason) values(employee,day,reason) on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
 update private.monitoring_revision set version=version+1 where id=true;
 select * into existing from private.attendance_punch_corrections where employee_id=employee and operational_date=day for update;
 if existing.updated_at is distinct from nullif(p_data->>'expectedUpdatedAt','')::timestamptz then raise exception using errcode='PT409',message='ATTENDANCE_STALE'; end if;
 before_record:=case when found then to_jsonb(existing) else null end;
 insert into private.attendance_punch_corrections(employee_id,operational_date,punches,reason,updated_by) values(employee,day,marks,reason,actor)
 on conflict(employee_id,operational_date) do update set punches=excluded.punches,reason=excluded.reason,updated_by=actor,updated_at=greatest(clock_timestamp(),attendance_punch_corrections.updated_at+interval '1 microsecond') returning to_jsonb(attendance_punch_corrections.*) into after_record;
 update public.monitoring_results set dirty=true where active and employee_id=employee and operational_date=day;
 insert into public.monitoring_audit(actor,action,target,detail) values(actor,'correct_punches',employee::text,jsonb_build_object('employeeId',employee,'date',day,'reason',reason,'before',before_record,'after',after_record));
 return jsonb_build_object('changed',true);
end $$;
revoke all on function private.attendance_history_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.attendance_history_impl(text,jsonb) to authenticated;
create function public.attendance_history(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.attendance_history_impl(p_action,p_data)$$;
revoke all on function public.attendance_history(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.attendance_history(text,jsonb) to authenticated;

alter function private.daily_call_evidence(uuid,date) rename to daily_call_evidence_before_corrections;
create function private.daily_call_evidence(p_employee uuid,p_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare output jsonb;
begin
 output:=private.daily_call_evidence_before_corrections(p_employee,p_date);
 if exists(select 1 from private.attendance_punch_corrections c join public.colaboradores e on e.id=c.employee_id
   where c.employee_id=p_employee and c.operational_date=p_date and e.admissao is not null and p_date>=e.admissao)
  and private.employee_attendance_allowed(p_employee,p_date) and not private.employee_absence_protected(p_employee,p_date)
  and p_date<=(clock_timestamp() at time zone 'America/Sao_Paulo')::date then
  output:=output||jsonb_build_object('state','present','status','P','blockers','[]'::jsonb,'correctionConfirmed',true);
 end if;
 return output;
end $$;
revoke all on function private.daily_call_evidence(uuid,date),private.daily_call_evidence_before_corrections(uuid,date) from public,anon,authenticated,service_role;
