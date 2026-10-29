-- Exact HR documents can discover a clock registration without a clock-side
-- employee number. Existing links (including revoked links) require human review.
alter table public.monitoring_bindings
  drop constraint monitoring_bindings_origin_check,
  add constraint monitoring_bindings_origin_check check(origin in ('manual','cloud_document','employee_document')),
  drop constraint monitoring_binding_creator,
  add constraint monitoring_binding_creator check(
    (origin='manual' and created_by is not null)
    or (origin='cloud_document' and created_by is null)
    or origin='employee_document');

create function private.employee_document_bindings(p_employee uuid,p_source text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare person public.colaboradores;candidate record;link_id uuid;links jsonb:='[]';actor uuid:=auth.uid();
begin
 -- Same order as manual binding management, the HR save path and the worker.
 perform pg_advisory_xact_lock(824202609,1);
 perform pg_advisory_xact_lock(791800,1);
 perform pg_advisory_xact_lock(791701);
 select * into person from public.colaboradores where id=p_employee;
 if person.id is null or not person.ativo_no_sistema or person.admissao is null then return links;end if;
 for candidate in
  select distinct on (s.identity_namespace,document.kind)
    s.id source_id,s.identity_namespace,document.kind,document.value,observed.first_at
  from private.employee_identifiers i
  cross join lateral (values ('cpf',i.cpf),('pis',i.pis)) document(kind,value)
  join public.monitoring_sources s on s.kind='afd' and s.active
    and s.configuration->>'sourceIdentityConfirmed'='true'
  cross join lateral (
    select min(e.occurred_at) first_at from public.monitoring_events e
    where e.source_id=s.id and e.identity_type=document.kind and e.identity_value=document.value
      and e.event_type='punch' and e.eligible and not e.conflicted and e.classification='authorized'
      and e.occurred_at>=person.admissao::timestamp at time zone s.timezone
      and e.occurred_at<=now()
  ) observed
  where i.employee_id=p_employee and private.monitoring_identifier_valid(document.value,document.kind)
    and not exists(select 1 from public.monitoring_bindings b join public.monitoring_sources existing_source on existing_source.id=b.source_id
      where existing_source.identity_namespace=s.identity_namespace and b.identity_type=document.kind and b.identity_value=document.value)
    and observed.first_at is not null
    and (p_source is null or s.id=p_source)
  order by s.identity_namespace,document.kind,observed.first_at,s.id
 loop
  -- Never replace/extend another link, restore a revocation or select by name.
  if exists(select 1 from public.monitoring_bindings b join public.monitoring_sources s on s.id=b.source_id
    where s.identity_namespace=candidate.identity_namespace and b.identity_type=candidate.kind and b.identity_value=candidate.value)
  then continue;end if;
  -- Admission bounds both historical recovery and later-arriving older files.
  -- Queue identity dates before its row exists and before changing revisions.
  perform private.monitoring_prepare_identity(person.id,candidate.source_id,candidate.kind,candidate.value,person.admissao,null);
  insert into public.monitoring_bindings(source_id,identity_type,identity_value,employee_id,valid_from,evidence,created_by,origin)
  values(candidate.source_id,candidate.kind,candidate.value,person.id,person.admissao,
    'Documento válido e único no cadastro RH com batida exata em relógio confirmado; vínculo automático',actor,'employee_document')
  returning id into link_id;
  update public.monitoring_results set dirty=true where employee_id=person.id and active and operational_date>=person.admissao;
  insert into public.monitoring_audit(actor,action,target,detail)
  values(actor,'employee_document_binding',link_id::text,jsonb_build_object(
    'employeeId',person.id,'sourceId',candidate.source_id,'identityType',candidate.kind,
    'validFrom',person.admissao,'firstObservedAt',candidate.first_at,
    'reason','Correspondência exata de documento RH com batida elegível; nenhum vínculo existente substituído'));
  links:=links||jsonb_build_array(jsonb_build_object('id',link_id,'sourceId',candidate.source_id,'identityType',candidate.kind));
 end loop;
 if jsonb_array_length(links)>0 then
  perform private.monitoring_enqueue(person.id,person.admissao,null,p_source);
  update private.monitoring_revision set version=version+1 where id=true;
  update private.daily_call_revision set version=version+1 where id=true;
 end if;
 return links;
end $$;
revoke all on function private.employee_document_bindings(uuid,text) from public,anon,authenticated,service_role;

-- Runs within the existing authorized HR save transaction, including clients
-- which resave a document added before this migration.
create function private.employee_document_saved() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform private.employee_document_bindings(new.employee_id);
 return new;
end $$;
revoke all on function private.employee_document_saved() from public,anon,authenticated,service_role;
create trigger employee_document_saved after insert or update on private.employee_identifiers
for each row execute function private.employee_document_saved();

-- Also discover a saved document when its first punch arrives later. This
-- covers local and cloud AFD ingestion, including single-document-type files.
alter function private.monitoring_ingest_impl(jsonb) rename to monitoring_ingest_before_employee_documents;
create function private.monitoring_ingest_impl(p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;employee uuid;afd boolean:=coalesce(p_data#>>'{source,kind}'='afd' and jsonb_typeof(p_data->'occurrences')='array',false);
begin
 if afd then
  perform pg_advisory_xact_lock(824202609,1);
  perform pg_advisory_xact_lock(791800,1);
  perform pg_advisory_xact_lock(791701);
 end if;
 result:=private.monitoring_ingest_before_employee_documents(p_data);
 if afd and result->>'ok'='true' then
  for employee in
    with documents as materialized (
      select distinct row#>>'{event,identity,type}' kind,row#>>'{event,identity,value}' value
      from jsonb_array_elements(p_data->'occurrences') row where row#>>'{event,type}'='punch'
    ), matches as (
      select i.employee_id from documents d join private.employee_identifiers i on d.kind='cpf' and i.cpf=d.value
      union
      select i.employee_id from documents d join private.employee_identifiers i on d.kind='pis' and i.pis=d.value
    ) select employee_id from matches order by employee_id
  loop
    perform private.employee_document_bindings(employee,p_data#>>'{source,id}');
  end loop;
 end if;
 return result;
end $$;
revoke all on function private.monitoring_ingest_before_employee_documents(jsonb),private.monitoring_ingest_impl(jsonb)
from public,anon,authenticated,service_role;
grant execute on function private.monitoring_ingest_impl(jsonb) to service_role;
