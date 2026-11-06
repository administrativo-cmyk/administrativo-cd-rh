-- A scheduled shift is deferred while its lease is in the future. Once due,
-- the job returns to the pending count without being reported as a failure.
do $$
declare definition text:=pg_get_functiondef('private.monitoring_processing_progress(jsonb)'::regprocedure);
begin
 if strpos(definition,'j.last_error is null and j.leased_until>now()')=0
    or strpos(definition,'count(*)filter(where last_error is not null) failed')=0
 then raise exception 'MONITORING_PROGRESS_DEFINITION_CHANGED';end if;
 definition:=replace(definition,'j.last_error is null and j.leased_until>now()',
   '(j.last_error is null or j.last_error=''AWAITING_SHIFT_START'') and j.leased_until>now()');
 execute replace(definition,'count(*)filter(where last_error is not null) failed',
   'count(*)filter(where last_error<>''AWAITING_SHIFT_START'') failed');
end $$;

create table private.clock_preregistrations (
 identity_type text not null check(identity_type in ('cpf','pis')),
 identity_value text not null check(identity_value ~ '^[0-9]{11}$'),
 source_id text not null,
 event_id uuid not null,
 last_punch_at timestamptz not null,
 primary key(identity_type,identity_value)
);
alter table private.clock_preregistrations enable row level security;
revoke all on private.clock_preregistrations from public,anon,authenticated,service_role;

create function private.clock_document_is_unregistered(p_kind text,p_value text) returns boolean
language sql stable set search_path='' as $$
 select not exists (
  select 1 from private.employee_identifiers i where i.cpf=p_value and p_kind='cpf'
  union all
  select 1 from private.employee_identifiers i where i.pis=p_value and p_kind='pis'
  union all
  select 1 from public.monitoring_bindings b where b.identity_type=p_kind and b.identity_value=p_value
 )
$$;

create function private.capture_clock_preregistrations(p_file uuid) returns void
language sql set search_path='' as $$
 insert into private.clock_preregistrations(identity_type,identity_value,source_id,event_id,last_punch_at)
 select distinct on (e.identity_type,e.identity_value)
  e.identity_type,e.identity_value,e.source_id,e.id,e.occurred_at
 from public.monitoring_events e
 join public.monitoring_sources s on s.id=e.source_id and s.kind='afd' and s.active
 where e.event_type='punch' and e.eligible and not e.conflicted
  and e.occurred_at>=now()-interval '20 days' and e.occurred_at<=now()
  and exists (
   select 1 from public.monitoring_occurrences o
   join public.monitoring_files f on f.id=o.file_id and f.completed_at is not null
   where o.event_id=e.id and not o.conflict and (p_file is null or o.file_id=p_file)
  )
  and private.monitoring_identifier_valid(e.identity_value,e.identity_type)
  and private.clock_document_is_unregistered(e.identity_type,e.identity_value)
 order by e.identity_type,e.identity_value,e.occurred_at desc,e.id
 on conflict(identity_type,identity_value) do update
 set source_id=excluded.source_id,event_id=excluded.event_id,last_punch_at=excluded.last_punch_at
 where (excluded.last_punch_at,excluded.event_id)>
  (clock_preregistrations.last_punch_at,clock_preregistrations.event_id)
$$;

create function private.clock_preregistration_import_completed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform private.capture_clock_preregistrations(new.id);
 return new;
end $$;

create trigger clock_preregistration_import_completed
after update of completed_at on public.monitoring_files
for each row when (old.completed_at is null and new.completed_at is not null)
execute function private.clock_preregistration_import_completed();

select private.capture_clock_preregistrations(null);

create function private.clock_preregistration_list(p_data jsonb) returns jsonb
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
   coalesce(jsonb_agg(jsonb_build_object('kind',identity_type,'document',identity_value,
    'sourceId',source_id,'lastPunchAt',last_punch_at) order by last_punch_at desc,identity_type,identity_value),'[]'))
  from page
 );
end $$;

revoke all on function private.clock_document_is_unregistered(text,text),
 private.capture_clock_preregistrations(uuid),private.clock_preregistration_import_completed(),
 private.clock_preregistration_list(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.clock_preregistration_list(jsonb) to authenticated;

create or replace function public.administration(p_entity text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_entity='employee' and p_action='clock-preregistrations' then
  return private.clock_preregistration_list(p_data);
 end if;
 return private.administration_lifecycle(p_entity,p_action,p_data);
end $$;
