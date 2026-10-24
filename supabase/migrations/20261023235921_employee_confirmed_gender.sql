-- Only confirmed source values are stored. Unknown employees remain NULL;
-- neither names nor photos are used to assign gender.
alter table public.colaboradores add column genero text;
alter table public.colaboradores add constraint employee_confirmed_gender
 check (genero is null or genero in ('feminino','masculino'));
comment on column public.colaboradores.genero is
 'Confirmed RH/employee information; NULL means not supplied. Never inferred from a name.';

alter function private.administration_rows(text) rename to administration_rows_before_gender;
create function private.administration_rows(p_entity text) returns setof jsonb
language sql stable security definer set search_path='' as $$
 select r || case when p_entity='employee' then jsonb_build_object('gender',(
  select c.genero from public.colaboradores c where c.id=(r->>'id')::uuid)) else '{}'::jsonb end
 from private.administration_rows_before_gender(p_entity) r
$$;
revoke all on function private.administration_rows_before_gender(text),private.administration_rows(text) from public,anon,authenticated,service_role;

-- Reuse existing authorization, CAS, employee history and final audit record.
-- Omission from an old client preserves the value; explicit NULL clears it.
do $migration$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('private.administration_lifecycle(text,text,jsonb)'::regprocedure);
 needle:='select * into previous from public.colaboradores where id=(p_data->>''id'')::uuid;';
 if strpos(definition,needle)=0 then raise exception 'EMPLOYEE_GENDER_VALIDATION_CHANGED';end if;
 definition:=replace(definition,needle,$body$
 if p_data?'gender' and jsonb_typeof(p_data->'gender')<>'null'
  and (jsonb_typeof(p_data->'gender')<>'string' or p_data->>'gender' not in ('feminino','masculino')) then
  raise exception 'EMPLOYEE_GENDER_INVALID';
 end if;
 $body$||needle);
 needle:='select r into after_row from private.administration_rows(''employee'') r where r->>''id''=employee::text;';
 if strpos(definition,needle)=0 then raise exception 'EMPLOYEE_GENDER_SAVE_CHANGED';end if;
 definition:=replace(definition,needle,$body$
 if p_data?'gender' then update public.colaboradores set genero=p_data->>'gender' where id=employee;end if;
 $body$||needle);
 execute definition;
end $migration$;
