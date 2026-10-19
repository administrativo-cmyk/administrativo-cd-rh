-- Employment dates are operational boundaries, never evidence of a return to work.
alter table public.colaboradores add column desligamento date, add column situacao_desde date, add column retorno_previsto date;
alter table public.colaboradores add constraint employee_lifecycle_dates check (
 (desligamento is null or (isfinite(desligamento) and (admissao is null or desligamento>=admissao))) and
 (situacao_desde is null or isfinite(situacao_desde)) and
 (retorno_previsto is null or (isfinite(retorno_previsto) and (situacao_desde is null or retorno_previsto>=situacao_desde))));

create table private.employee_identifiers (
 employee_id uuid primary key references public.colaboradores(id), cpf text unique, pis text unique,
 check(cpf is null or private.monitoring_identifier_valid(cpf,'cpf')),
 check(pis is null or private.monitoring_identifier_valid(pis,'pis')));
create table private.employee_absence_periods (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.colaboradores(id),
 situation public.situacao_colaborador not null, start_date date not null, expected_return date, actual_return date,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check(actual_return is null or actual_return>=start_date), check(expected_return is null or expected_return>=start_date));
create unique index employee_one_open_absence on private.employee_absence_periods(employee_id) where actual_return is null;
create index employee_absence_history on private.employee_absence_periods(employee_id,start_date);
create table private.employee_lifecycle_audit (
 id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.colaboradores(id),
 actor uuid references auth.users, action text not null check(action in ('save','automatic_return')),
 reason text not null,before_record jsonb,after_record jsonb,evidence jsonb,created_at timestamptz not null default clock_timestamp());
create table private.employee_lifecycle_signals (
 employee_id uuid primary key references public.colaboradores(id),kind text not null check(kind in ('return_suggested','return_overdue','dates_missing')),
 evidence jsonb not null default '{}',employee_version timestamptz not null,evaluated_at timestamptz not null default clock_timestamp());
create index employee_lifecycle_history on private.employee_lifecycle_audit(employee_id,created_at desc);
create index employee_lifecycle_actor on private.employee_lifecycle_audit(actor) where actor is not null;
alter table private.employee_identifiers enable row level security;
alter table private.employee_absence_periods enable row level security;
alter table private.employee_lifecycle_audit enable row level security;
alter table private.employee_lifecycle_signals enable row level security;
revoke all on private.employee_identifiers,private.employee_absence_periods,private.employee_lifecycle_audit,private.employee_lifecycle_signals from public,anon,authenticated,service_role;

-- Accept only valid, exact, unambiguous government identifiers. No name-based guessing.
with candidates as (
 select b.employee_id,b.identity_type,min(b.identity_value) value from public.monitoring_bindings b
 where b.revoked_at is null and b.identity_type in ('cpf','pis') and b.valid_from<=(now() at time zone 'America/Sao_Paulo')::date
 and (b.valid_to is null or b.valid_to>=(now() at time zone 'America/Sao_Paulo')::date)
 and private.monitoring_identifier_valid(b.identity_value,b.identity_type)
 group by b.employee_id,b.identity_type having count(distinct b.identity_value)=1
), unique_values as (select * from candidates c where not exists(select 1 from candidates o where o.identity_type=c.identity_type and o.value=c.value and o.employee_id<>c.employee_id))
insert into private.employee_identifiers(employee_id,cpf,pis)
select employee_id,max(value) filter(where identity_type='cpf'),max(value) filter(where identity_type='pis') from unique_values group by employee_id;

create function private.employee_is_away(p_situation text) returns boolean language sql immutable set search_path='' as $$
 select p_situation in ('FERIAS','AFASTADO','LICENCA_MATERNIDADE','ACIDENTE_TRABALHO','OUTRO_AFASTAMENTO')
$$;
create function private.employee_attendance_allowed(p_employee uuid,p_date date) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select c.ativo_no_sistema and (c.admissao is null or p_date>=c.admissao)
 and (c.desligamento is null or p_date<=c.desligamento)
 and (c.situacao<>'DESLIGADO' or c.desligamento is not null)
 from public.colaboradores c where c.id=p_employee),false)
$$;
create function private.employee_absence_protected(p_employee uuid,p_date date) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.employee_absence_periods a where a.employee_id=p_employee and p_date>=a.start_date and (a.actual_return is null or p_date<a.actual_return))
 or exists(select 1 from public.colaboradores c where c.id=p_employee and private.employee_is_away(c.situacao::text) and (c.situacao_desde is null or p_date>=c.situacao_desde))
$$;

-- Historical leave remains protected even after the employee becomes active again.
insert into private.employee_absence_periods(employee_id,situation,start_date,expected_return)
select id,situacao,coalesce(situacao_desde,admissao,created_at::date),retorno_previsto from public.colaboradores where private.employee_is_away(situacao::text);

alter function private.administration_rows(text) rename to administration_rows_before_lifecycle;
create function private.administration_rows(p_entity text) returns setof jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_entity<>'employee' then return query select * from private.administration_rows_before_lifecycle(p_entity);return;end if;
 return query select r||jsonb_build_object('terminationDate',c.desligamento,'situationFrom',c.situacao_desde,'expectedReturnDate',c.retorno_previsto,
 'cpf',i.cpf,'pis',i.pis,'defaultSchedule',(select s.payload from public.monitoring_settings s where s.kind='schedule' and s.target=c.id::text and s.revoked_at is null
 and s.valid_from<=(now() at time zone 'America/Sao_Paulo')::date and (s.valid_to is null or s.valid_to>=(now() at time zone 'America/Sao_Paulo')::date) order by s.valid_from desc,s.id limit 1),
 'statusSignal',(select jsonb_build_object('kind',sig.kind,'evidence',sig.evidence,'evaluatedAt',sig.evaluated_at) from private.employee_lifecycle_signals sig where sig.employee_id=c.id and sig.employee_version=c.updated_at))
 from private.administration_rows_before_lifecycle('employee') r join public.colaboradores c on c.id=(r->>'id')::uuid left join private.employee_identifiers i on i.employee_id=c.id;
end $$;

-- Preserve existing permissions, pagination, CAS, catalogs and audit while extending filters.
do $migration$
declare definition text;needle text:='and (p_data->>''status'' is null or r->>''status''=p_data->>''status'')';
begin
 definition:=pg_get_functiondef('private.administration_impl(text,text,jsonb)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'LIFECYCLE_ADMIN_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,needle||' and (p_data->>''situation'' is null or (p_entity=''employee'' and r->>''situation''=p_data->>''situation''))');
end $migration$;

create function private.administration_lifecycle(p_entity text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; previous public.colaboradores; current_row public.colaboradores; before_row jsonb; after_row jsonb; employee uuid;
 termination date; started date; expected date; cpf_value text;pis_value text; away boolean; returning_from_leave boolean; episode private.employee_absence_periods;
begin
 if p_entity<>'employee' or p_action<>'save' then return private.administration_catalogs(p_entity,p_action,p_data);end if;
 -- Global locks precede worker jobs/revisions and employee locks, as in the existing CRUD.
 perform pg_advisory_xact_lock(824202609,1);perform pg_advisory_xact_lock(791800,1);
 if not exists(select 1 from public.perfis where id=auth.uid() and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH')) then raise exception using errcode='42501',message='ADMINISTRATION_FORBIDDEN';end if;
 select * into previous from public.colaboradores where id=(p_data->>'id')::uuid;
 select r into before_row from private.administration_rows('employee') r where r->>'id'=previous.id::text;
 termination:=nullif(p_data->>'terminationDate','')::date;started:=nullif(p_data->>'situationFrom','')::date;expected:=nullif(p_data->>'expectedReturnDate','')::date;
 cpf_value:=nullif(p_data->>'cpf','');pis_value:=nullif(p_data->>'pis','');away:=private.employee_is_away(p_data->>'situation');
 returning_from_leave:=previous.id is not null and private.employee_is_away(previous.situacao::text) and not away;
 if (p_data->>'situation'='DESLIGADO' and termination is null) or (termination is not null and (p_data->>'situation'<>'DESLIGADO' or not isfinite(termination) or termination<(p_data->>'admissionDate')::date))
 or (away and (started is null or expected is null)) or (started is not null and (not isfinite(started) or started<(p_data->>'admissionDate')::date))
 or (expected is not null and (not isfinite(expected) or not away or expected<started))
 or (returning_from_leave and p_data->>'situation'='ATIVO' and (started is null or started<coalesce(previous.situacao_desde,previous.admissao))) then raise exception 'EMPLOYEE_LIFECYCLE_DATES';end if;
 if (cpf_value is not null and not private.monitoring_identifier_valid(cpf_value,'cpf')) or (pis_value is not null and not private.monitoring_identifier_valid(pis_value,'pis')) then raise exception 'EMPLOYEE_IDENTIFIER_INVALID';end if;
 if exists(select 1 from private.employee_identifiers i where i.employee_id is distinct from previous.id and ((cpf_value is not null and i.cpf=cpf_value) or (pis_value is not null and i.pis=pis_value))) then raise exception 'EMPLOYEE_IDENTIFIER_CONFLICT';end if;
 if exists(select 1 from public.monitoring_bindings b where b.employee_id is distinct from previous.id and b.revoked_at is null
 and b.valid_from<=(now() at time zone 'America/Sao_Paulo')::date and (b.valid_to is null or b.valid_to>=(now() at time zone 'America/Sao_Paulo')::date)
 and ((b.identity_type='cpf' and cpf_value is not null and b.identity_value=cpf_value) or (b.identity_type='pis' and pis_value is not null and b.identity_value=pis_value))) then raise exception 'EMPLOYEE_IDENTIFIER_CONFLICT';end if;
 result:=private.administration_catalogs(p_entity,p_action,p_data);employee:=(result->>'id')::uuid;
 update public.colaboradores set desligamento=termination,situacao_desde=started,retorno_previsto=case when away then expected end where id=employee returning * into current_row;
 insert into private.employee_identifiers(employee_id,cpf,pis) values(employee,cpf_value,pis_value) on conflict(employee_id) do update set cpf=excluded.cpf,pis=excluded.pis;
 select * into episode from private.employee_absence_periods where employee_id=employee and actual_return is null for update;
 if away then
  if episode.id is null then insert into private.employee_absence_periods(employee_id,situation,start_date,expected_return) values(employee,current_row.situacao,started,expected);
  elsif episode.situation<>current_row.situacao then
   if started<episode.start_date then raise exception 'EMPLOYEE_LIFECYCLE_DATES';end if;
   update private.employee_absence_periods set actual_return=started,updated_at=clock_timestamp() where id=episode.id;
   insert into private.employee_absence_periods(employee_id,situation,start_date,expected_return) values(employee,current_row.situacao,started,expected);
  else update private.employee_absence_periods set situation=current_row.situacao,start_date=started,expected_return=expected,updated_at=clock_timestamp() where id=episode.id;end if;
 elsif episode.id is not null then
  if current_row.situacao<>'DESLIGADO' and (started is null or started<episode.start_date) then raise exception 'EMPLOYEE_LIFECYCLE_DATES';end if;
  update private.employee_absence_periods set actual_return=case when current_row.situacao='DESLIGADO' then greatest(episode.start_date,termination+1) else started end,updated_at=clock_timestamp() where id=episode.id;
 end if;
 delete from private.employee_lifecycle_signals where employee_id=employee;
 select r into after_row from private.administration_rows('employee') r where r->>'id'=employee::text;
 insert into private.employee_lifecycle_audit(employee_id,actor,action,reason,before_record,after_record) values(employee,auth.uid(),'save',p_data->>'reason',before_row,after_row);
 return result||jsonb_build_object('record',after_row);
end $$;
create or replace function public.administration(p_entity text,p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.administration_lifecycle(p_entity,p_action,p_data) $$;
revoke all on function private.administration_rows_before_lifecycle(text),private.administration_rows(text),private.employee_is_away(text),private.employee_attendance_allowed(uuid,date),private.employee_absence_protected(uuid,date),private.administration_lifecycle(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.administration_lifecycle(text,text,jsonb) to authenticated;
-- All employee writes must traverse lifecycle validation; these are internal delegates.
revoke all on function private.administration_impl(text,text,jsonb),private.administration_catalogs(text,text,jsonb) from authenticated;
