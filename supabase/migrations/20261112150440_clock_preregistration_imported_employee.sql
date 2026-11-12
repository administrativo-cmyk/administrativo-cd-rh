create table private.clock_preregistration_users (
 source_id text not null references public.monitoring_sources(id),
 identity_type text not null check(identity_type in ('cpf','pis')),
 identity_value text not null check(private.monitoring_identifier_valid(identity_value,identity_type)),
 employee_number text not null check(length(employee_number) between 1 and 100),
 normalized_name text not null check(length(normalized_name) between 1 and 200),
 file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'),
 source_row integer not null check(source_row>1),
 primary key(source_id,identity_type,identity_value)
);
alter table private.clock_preregistration_users enable row level security;
revoke all on private.clock_preregistration_users from public,anon,authenticated,service_role;

create index operational_import_rows_clock_cpf
 on private.operational_import_rows ((input->>'cpf')) where input ? 'cpf';
create index operational_import_rows_clock_pis
 on private.operational_import_rows ((input->>'pis')) where input ? 'pis';

create or replace function private.clock_preregistration_list(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare page_offset integer:=coalesce((p_data->>'offset')::integer,0);
begin
 if not exists(select 1 from public.perfis where id=(select auth.uid())
  and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH'))
 then raise exception using errcode='42501',message='ADMINISTRATION_FORBIDDEN';end if;
 if page_offset not between 0 and 100000 then raise exception 'ADMINISTRATION_INVALID_INPUT';end if;
 return (
  with visible as (
   select p.identity_type,p.identity_value,p.source_id,p.last_punch_at
   from private.clock_preregistrations p
   where private.clock_document_is_unregistered(p.identity_type,p.identity_value)
    and not exists(select 1 from public.monitoring_events e where e.id=p.event_id and e.conflicted)
  ), page as (
   select * from visible order by last_punch_at desc,identity_type,identity_value limit 25 offset page_offset
  )
  select jsonb_build_object('total',(select count(*) from visible),'rows',
   coalesce(jsonb_agg(jsonb_build_object('kind',p.identity_type,'document',p.identity_value,
    'sourceId',p.source_id,'lastPunchAt',p.last_punch_at,'employeeNumber',clock.number,'name',facial.name)
    order by p.last_punch_at desc,p.identity_type,p.identity_value),'[]'))
  from page p
  left join lateral (
   select min(candidate.number) number,min(candidate.name) name
   from (
    select u.employee_number number,u.normalized_name name
    from private.clock_preregistration_users u
    where u.source_id=p.source_id and u.identity_type=p.identity_type and u.identity_value=p.identity_value
    union all
    select r.input->>'employeeNumber',nullif(private.operational_import_name(r.input->>'name'),'')
    from private.operational_import_rows r
    join private.operational_import_batches b on b.id=r.batch_id and b.kind='clock' and b.defaults->>'sourceId'=p.source_id
    where ((p.identity_type='cpf' and r.input ? 'cpf' and r.input->>'cpf'=p.identity_value)
        or (p.identity_type='pis' and r.input ? 'pis' and r.input->>'pis'=p.identity_value))
     -- New employees cannot be applied by the existing binding import.
     and r.errors <@ '["MATRICULA_NAO_ENCONTRADA"]'::jsonb
     and length(r.input->>'employeeNumber') between 1 and 100
   ) candidate
   having count(distinct candidate.number)=1 and count(distinct candidate.name)<=1
    and not bool_or(exists(select 1 from private.employee_numbers n where n.number=candidate.number))
    and not bool_or(exists(select 1 from public.colaboradores c where c.ativo_no_sistema
     and position(' ' in candidate.name)>0 and private.operational_import_name(c.nome)=candidate.name))
  ) clock on true
  left join lateral (
   select min(btrim(person.name)) name
   from public.monitoring_people person
   join public.monitoring_sources s on s.id=person.source_id and s.kind='defense-person' and s.active
   join public.monitoring_files f on f.id=person.file_id and f.completed_at is not null
   where person.external_id=clock.number
   having bool_and(not person.ambiguous and length(btrim(person.name)) between 1 and 200)
    and count(distinct private.operational_import_name(person.name))=1
    and (nullif(clock.name,'') is null or min(private.operational_import_name(person.name))=clock.name)
  ) facial on true
 );
end $$;
