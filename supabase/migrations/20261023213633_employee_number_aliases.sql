-- Reserve current and historical numbers together. Names never bind identities.
create table private.employee_numbers (
 number text primary key check(length(number) between 1 and 100 and number=btrim(number)),
 employee_id uuid not null references public.colaboradores(id) on delete cascade
);
create index employee_numbers_employee on private.employee_numbers(employee_id);
alter table private.employee_numbers enable row level security;
revoke all on private.employee_numbers from public,anon,authenticated,service_role;
insert into private.employee_numbers(number,employee_id) select btrim(matricula),id from public.colaboradores;

create function private.employee_number_reserve() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(791809);
 if exists(select 1 from private.employee_numbers where number=btrim(new.matricula) and employee_id<>new.id) then
  raise exception 'EMPLOYEE_NUMBER_CONFLICT';
 end if;
 insert into private.employee_numbers(number,employee_id) values(btrim(new.matricula),new.id) on conflict(number) do nothing;
 return new;
end $$;
create trigger employee_number_reserve after insert or update of matricula on public.colaboradores
 for each row execute function private.employee_number_reserve();

create function private.employee_additional_numbers(p_employee uuid) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(n.number order by n.number),'[]') from private.employee_numbers n
 join public.colaboradores c on c.id=n.employee_id where n.employee_id=p_employee and n.number<>btrim(c.matricula)
$$;

create function private.employee_numbers_save(p_employee uuid,p_numbers jsonb) returns void
language plpgsql set search_path='' as $$
begin
 -- Omission from an older client preserves existing numbers.
 if p_numbers is null then return;end if;
 if jsonb_typeof(p_numbers) is distinct from 'array' then raise exception 'EMPLOYEE_NUMBERS_INVALID';end if;
 if jsonb_array_length(p_numbers)>20 or exists(select 1 from jsonb_array_elements(p_numbers) n where jsonb_typeof(n)<>'string' or length(btrim(n#>>'{}')) not between 1 and 100) then raise exception 'EMPLOYEE_NUMBERS_INVALID';end if;
 perform pg_advisory_xact_lock(791809);
 if exists(select 1 from jsonb_array_elements_text(p_numbers) n join private.employee_numbers r on r.number=btrim(n) where r.employee_id<>p_employee) then raise exception 'EMPLOYEE_NUMBER_CONFLICT';end if;
 delete from private.employee_numbers n where employee_id=p_employee
 and number<>(select btrim(matricula) from public.colaboradores where id=p_employee)
 and not exists(select 1 from jsonb_array_elements_text(p_numbers) v where btrim(v)=n.number);
 insert into private.employee_numbers(number,employee_id) select distinct btrim(n),p_employee from jsonb_array_elements_text(p_numbers) n on conflict(number) do nothing;
end $$;

alter function private.administration_rows(text) rename to administration_rows_before_numbers;
create function private.administration_rows(p_entity text) returns setof jsonb
language sql stable security definer set search_path='' as $$
 select r || case when p_entity='employee' then jsonb_build_object('additionalEmployeeNumbers',private.employee_additional_numbers((r->>'id')::uuid)) else '{}'::jsonb end
 from private.administration_rows_before_numbers(p_entity) r
$$;

-- Keep CAS, role checks and final audit inside the existing save transaction.
do $migration$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('private.administration_lifecycle(text,text,jsonb)'::regprocedure);
 needle:='select * into previous from public.colaboradores where id=(p_data->>''id'')::uuid;';
 if strpos(definition,needle)=0 then raise exception 'EMPLOYEE_NUMBERS_VALIDATION_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,$body$
 if p_data?'additionalEmployeeNumbers' then
  if jsonb_typeof(p_data->'additionalEmployeeNumbers') is distinct from 'array' then raise exception 'EMPLOYEE_NUMBERS_INVALID';end if;
  if jsonb_array_length(p_data->'additionalEmployeeNumbers')>20 or exists(select 1 from jsonb_array_elements(p_data->'additionalEmployeeNumbers') n where jsonb_typeof(n)<>'string' or length(btrim(n#>>'{}')) not between 1 and 100) then raise exception 'EMPLOYEE_NUMBERS_INVALID';end if;
 end if;
 perform pg_advisory_xact_lock(791809);
 $body$||needle);
 needle:='select r into after_row from private.administration_rows(''employee'') r where r->>''id''=employee::text;';
 if strpos(definition,needle)=0 then raise exception 'EMPLOYEE_NUMBERS_SAVE_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,'perform private.employee_numbers_save(employee,case when p_data?''additionalEmployeeNumbers'' and previous.matricula is not null and previous.matricula<>current_row.matricula then (p_data->''additionalEmployeeNumbers'')||to_jsonb(btrim(previous.matricula)) else p_data->''additionalEmployeeNumbers'' end); '||needle);
 execute definition;
 definition:=pg_get_functiondef('private.administration_impl(text,text,jsonb)'::regprocedure);
 needle:='r->>''employeeName'',r->>''employeeNumber''';
 if strpos(definition,needle)=0 then raise exception 'EMPLOYEE_NUMBERS_SEARCH_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,needle||',r->>''additionalEmployeeNumbers''');

 -- AFD events still use verified CPF/PIS bindings. Aliases only identify the RH row.
 definition:=pg_get_functiondef('private.operational_import_impl(text,jsonb)'::regprocedure);
 needle:='select * into employee from public.colaboradores where matricula=input->>''employeeNumber'' and ativo_no_sistema;';
 if strpos(definition,needle)=0 then raise exception 'EMPLOYEE_NUMBERS_IMPORT_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,$body$
 select c.* into employee from public.colaboradores c where c.ativo_no_sistema and
 case when batch.kind='clock' then exists(select 1 from private.employee_numbers n where n.employee_id=c.id and n.number=btrim(input->>'employeeNumber'))
 else c.matricula=input->>'employeeNumber' end;
 $body$);
 -- Insert after the existing NOT FOUND check, which depends on SELECT's FOUND flag.
 needle:='if nullif(input->>''cpf'','''') is null and nullif(input->>''pis'','''') is null then';
 if strpos(definition,needle)=0 then raise exception 'EMPLOYEE_NUMBERS_ALERT_DEFINITION_CHANGED';end if;
 definition:=replace(definition,needle,$body$
 if batch.kind='clock' and (employee.id is null or private.operational_import_name(employee.nome) is distinct from private.operational_import_name(input->>'name')) and exists(select 1 from public.colaboradores c where c.ativo_no_sistema
 and position(' ' in private.operational_import_name(input->>'name'))>0
 and private.operational_import_name(c.nome)=private.operational_import_name(input->>'name')
 and not exists(select 1 from private.employee_numbers n where n.employee_id=c.id and n.number=btrim(input->>'employeeNumber'))) then
  problems:=problems||'"MATRICULA_DIVERGENTE_MESMO_NOME"'::jsonb;
 end if;
 $body$||needle);
 execute definition;
 -- Include historical numbers in the employee drawer shown by Chamada Diária.
 definition:=pg_get_functiondef('private.daily_call_read_impl(date,date,date,text)'::regprocedure);
 needle:='''employeeNumber'',c.matricula';
 if strpos(definition,needle)=0 then raise exception 'EMPLOYEE_NUMBERS_DRAWER_DEFINITION_CHANGED';end if;
 execute replace(definition,needle,needle||',''additionalEmployeeNumbers'',private.employee_additional_numbers(c.id)');
end $migration$;

-- Show all exact full-name candidates, including homonyms, without selecting one.
alter function private.operational_import_snapshot(uuid) rename to operational_import_snapshot_before_numbers;
create function private.operational_import_snapshot(batch uuid) returns jsonb
language sql stable set search_path='' as $$
 select snapshot || jsonb_build_object('rows',coalesce((select jsonb_agg(r || jsonb_build_object('nameCandidates',
 case when r->'errors' @> '["MATRICULA_DIVERGENTE_MESMO_NOME"]' then
 (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.nome,'employeeNumber',c.matricula,'additionalEmployeeNumbers',private.employee_additional_numbers(c.id)) order by c.nome,c.matricula),'[]')
 from public.colaboradores c where c.ativo_no_sistema and private.operational_import_name(c.nome)=private.operational_import_name(r#>>'{input,name}'))
 else '[]'::jsonb end) order by ordinal)
 from jsonb_array_elements(snapshot->'rows') with ordinality x(r,ordinal)),'[]'))
 from private.operational_import_snapshot_before_numbers(batch) snapshot
$$;
revoke all on function private.employee_number_reserve(),private.employee_additional_numbers(uuid),private.employee_numbers_save(uuid,jsonb),private.administration_rows_before_numbers(text),private.administration_rows(text),private.operational_import_snapshot_before_numbers(uuid),private.operational_import_snapshot(uuid) from public,anon,authenticated,service_role;
