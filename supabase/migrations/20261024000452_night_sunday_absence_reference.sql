-- User rule: retain 12x36; derive women's alternating Sunday from a closed,
-- completely collected Sunday night journey without clock punches.
-- A blank gender, partial collection, ambiguous identity or protected absence
-- never becomes an assumed rest date.
create table private.employee_sunday_off_references (
 employee_id uuid primary key references public.colaboradores(id),
 anchor_date date not null check(extract(dow from anchor_date)=0),
 setting_id uuid not null references public.monitoring_settings(id),
 evidence jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table private.employee_sunday_off_references enable row level security;
revoke all on private.employee_sunday_off_references from public,anon,authenticated,service_role;

create function private.night_sunday_absence_anchor(
 p_employee uuid,p_start time,p_end time,p_from date,p_to date,
 p_reference timestamptz default now()) returns date
language plpgsql stable security definer set search_path='' as $$
declare day date; window_start timestamptz; window_end timestamptz;
 span interval:=(p_end-p_start)+interval '1 day'; margin interval; required_sources text[];
begin
 if p_end>=p_start or span>=interval '18 hours' then return null;end if;
 margin:=(interval '1 day'-span)/2;
 for day in select d::date from generate_series(greatest(p_from,private.monitoring_archive_cutoff())::timestamp,
  least(coalesce(p_to,(p_reference at time zone 'America/Sao_Paulo')::date),(p_reference at time zone 'America/Sao_Paulo')::date)::timestamp,interval '1 day') d
  where extract(dow from d)=0 order by d loop
  window_start:=(day+p_start) at time zone 'America/Sao_Paulo';
  window_end:=window_start+span+margin; window_start:=window_start-margin;
  if window_end>p_reference or not private.employee_attendance_allowed(p_employee,day)
   or private.employee_absence_protected(p_employee,day)
   or private.monitoring_archive_manual_day(p_employee,day)
   or private.calendar_resolution(p_employee,day)->>'state'<>'unchanged'
   or exists(select 1 from public.ferias_planejamento f where f.colaborador_id=p_employee and f.archived_at is null and f.status='approved' and day between f.inicio and f.fim)
   then continue;end if;

  select array_agg(distinct s.id) into required_sources from public.monitoring_bindings b
   join public.monitoring_sources bs on bs.id=b.source_id
   join public.monitoring_sources s on s.identity_namespace=bs.identity_namespace and s.kind='afd'
   where b.employee_id=p_employee and b.identity_type in ('cpf','pis') and b.revoked_at is null
    and b.valid_from<=day and coalesce(b.valid_to,'9999-12-31')>=day+1;
  if coalesce(cardinality(required_sources),0)=0 then continue;end if;
  if exists(select 1 from public.monitoring_sources s where s.id=any(required_sources) and (
   not s.active or s.configuration->>'sourceIdentityConfirmed' is distinct from 'true'
   or s.configuration#>>'{declaredCoverage,continuous}' is distinct from 'true'
   or coalesce((s.configuration#>>'{declaredCoverage,from}')::timestamptz,'infinity')>window_start
   or coalesce((s.configuration#>>'{declaredCoverage,to}')::timestamptz,'-infinity')<window_end
   or coalesce(s.last_success_at,'-infinity')<window_end or s.worker_state='error'
   or not exists(select 1 from public.monitoring_files f where f.source_id=s.id and f.status='complete' and f.completed_at>=window_end)
   or exists(select 1 from public.monitoring_files f where f.source_id=s.id and (f.status<>'complete' or f.rejected_rows>0 or f.conflict_rows>0))
   or exists(select 1 from public.monitoring_attempts a where a.source_id=s.id and not exists(select 1 from public.monitoring_files f where f.source_id=s.id and f.relative_path=a.relative_path and f.status='complete' and f.rejected_rows=0 and f.conflict_rows=0 and f.completed_at>=a.created_at))
  )) then continue;end if;
  if exists(select 1 from public.monitoring_bindings b
   join public.monitoring_sources bs on bs.id=b.source_id
   join public.monitoring_sources os on os.identity_namespace=bs.identity_namespace
   join public.monitoring_bindings other on other.source_id=os.id and other.identity_type=b.identity_type and other.identity_value=b.identity_value
   where b.employee_id=p_employee and b.revoked_at is null and other.revoked_at is null and other.employee_id<>p_employee
   and b.valid_from<=day+1 and coalesce(b.valid_to,'9999-12-31')>=day
   and other.valid_from<=day+1 and coalesce(other.valid_to,'9999-12-31')>=day) then continue;end if;
  -- Any linked clock mark blocks absence, including rejected/conflicted marks.
  -- They require review rather than becoming evidence of a Sunday off.
  if exists(select 1 from public.monitoring_events e
   join public.monitoring_sources s on s.id=e.source_id
   join public.monitoring_sources bs on bs.identity_namespace=s.identity_namespace
   join public.monitoring_bindings b on b.source_id=bs.id and b.identity_type=e.identity_type and b.identity_value=e.identity_value
   where b.employee_id=p_employee and b.revoked_at is null and e.event_type='punch'
   and e.occurred_at>=window_start and e.occurred_at<window_end
   and b.valid_from<=(e.occurred_at at time zone s.timezone)::date and coalesce(b.valid_to,'9999-12-31')>=(e.occurred_at at time zone s.timezone)::date)
   then continue;end if;
  return day;
 end loop;
 return null;
end $$;
revoke all on function private.night_sunday_absence_anchor(uuid,time,time,date,date,timestamptz) from public,anon,authenticated,service_role;

create function private.employee_weekly_rest_payload(p_employee uuid,p jsonb,p_setting uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare answer jsonb; gender text; original public.monitoring_settings; anchor date;
begin
 if p?'cycle' then return p-'weeklyRest';end if;
 answer:=private.schedule_weekly_rest_payload(p);
 if p->'days'='[]'::jsonb then answer:=jsonb_set(answer,'{days}','[]');end if;
 if p->>'end'>=p->>'start' then return answer;end if;
 select c.genero into gender from public.colaboradores c where c.id=p_employee;
 if gender='masculino' then return jsonb_set(answer,'{weeklyRest}','{"kind":"night"}');end if;
 if gender is distinct from 'feminino' then return jsonb_set(answer,'{weeklyRest}','{"kind":"night-pending"}');end if;
 select r.anchor_date into anchor from private.employee_sunday_off_references r where r.employee_id=p_employee;
 select * into original from public.monitoring_settings s where s.id=p_setting and s.kind='schedule' and s.target=p_employee::text;
 if anchor is null and original.id is not null then
  anchor:=private.night_sunday_absence_anchor(p_employee,(p->>'start')::time,(p->>'end')::time,original.valid_from,original.valid_to);
 end if;
 return jsonb_set(answer,'{weeklyRest}',jsonb_strip_nulls(jsonb_build_object('kind','night-women','sundayOffAnchor',anchor)));
end $$;
revoke all on function private.employee_weekly_rest_payload(uuid,jsonb,uuid) from public,anon,authenticated,service_role;

do $$ declare definition text; signature text; needle text;begin
 foreach signature in array array['private.schedule_window_rows(uuid,date,date)','private.schedule_attribution_rows(uuid,date,date)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);needle:='private.schedule_weekly_rest_payload(row.payload)';
  if strpos(definition,needle)=0 then raise exception 'NIGHT_REFERENCE_WINDOW_CHANGED';end if;
  execute replace(definition,needle,'private.employee_weekly_rest_payload(p_employee,row.payload,row.id)');
 end loop;
 definition:=pg_get_functiondef('private.employee_schedule_snapshot(uuid,date,boolean)'::regprocedure);
 needle:='private.schedule_weekly_rest_payload(s.payload)';
 if strpos(definition,needle)=0 then raise exception 'NIGHT_REFERENCE_SNAPSHOT_CHANGED';end if;
 execute replace(definition,needle,'private.employee_weekly_rest_payload(p_employee,s.payload,s.id)');
end $$;

-- Save the first confirmed phase once. Source retention and later exceptional
-- work on a rest Sunday must not silently change the whole alternating roster.
create function private.refresh_employee_sunday_references(p_employee uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare row record; anchor date; inserted integer; proof jsonb;
begin
 for row in select distinct on (c.id) c.id employee_id,s.id setting_id,s.payload,s.valid_from,s.valid_to
  from public.colaboradores c join public.monitoring_settings s on s.target=c.id::text
  where c.genero='feminino' and c.ativo_no_sistema and (p_employee is null or c.id=p_employee)
  and s.kind='schedule' and s.revoked_at is null and not(s.payload?'cycle') and s.payload->>'end'<s.payload->>'start'
  and s.valid_from<=(now() at time zone 'America/Sao_Paulo')::date and coalesce(s.valid_to,'9999-12-31')>=(now() at time zone 'America/Sao_Paulo')::date
  and not exists(select 1 from private.employee_sunday_off_references r where r.employee_id=c.id)
  order by c.id,s.valid_from loop
  anchor:=private.night_sunday_absence_anchor(row.employee_id,(row.payload->>'start')::time,(row.payload->>'end')::time,row.valid_from,row.valid_to);
  if anchor is null then continue;end if;
  select jsonb_build_object('rule','first_complete_sunday_without_punches/1','operationalDate',anchor,'start',row.payload->>'start','end',row.payload->>'end',
   'sources',coalesce(jsonb_agg(distinct jsonb_build_object('id',s.id,'coverage',s.configuration->'declaredCoverage','lastSuccessAt',s.last_success_at)),'[]')) into proof
   from public.monitoring_bindings b join public.monitoring_sources bs on bs.id=b.source_id
   join public.monitoring_sources s on s.identity_namespace=bs.identity_namespace and s.kind='afd'
   where b.employee_id=row.employee_id and b.identity_type in ('cpf','pis') and b.revoked_at is null
   and b.valid_from<=anchor and coalesce(b.valid_to,'9999-12-31')>=anchor+1;
  insert into private.employee_sunday_off_references(employee_id,anchor_date,setting_id,evidence)
   values(row.employee_id,anchor,row.setting_id,proof) on conflict(employee_id) do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then continue;end if;
  insert into public.monitoring_audit(actor,action,target,detail) values(auth.uid(),'sunday_off_reference',row.employee_id::text,proof);
  update private.monitoring_revision set version=version+1 where id=true;
  update public.monitoring_results set dirty=true where active and employee_id=row.employee_id;
  insert into public.monitoring_jobs(employee_id,operational_date,reason)
   select employee_id,operational_date,'Referência confirmada da folga dominical alternada' from public.monitoring_results where active and dirty and employee_id=row.employee_id
   on conflict(employee_id,operational_date) do update set reason=excluded.reason;
 end loop;
end $$;
revoke all on function private.refresh_employee_sunday_references(uuid) from public,anon,authenticated,service_role;

-- Existing imports, coverage updates, roster saves and gender edits already
-- enqueue monitoring work. Reuse that path so future references resolve too.
alter function private.monitoring_enqueue(uuid,date,date,text) rename to monitoring_enqueue_before_sunday_reference;
create function private.monitoring_enqueue(p_employee uuid default null,p_start date default null,p_end date default null,p_source text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.monitoring_enqueue_before_sunday_reference(p_employee,p_start,p_end,p_source);
 if p_source is null or exists(select 1 from public.monitoring_sources where id=p_source and kind='afd') then
  perform private.refresh_employee_sunday_references(p_employee);
 end if;
end $$;
revoke all on function private.monitoring_enqueue_before_sunday_reference(uuid,date,date,text),private.monitoring_enqueue(uuid,date,date,text) from public,anon,authenticated,service_role;

-- A confirmed gender edit changes the effective roster. Keep existing jobs and
-- leases intact while invalidating derived results, never posted bank entries.
create function private.employee_gender_roster_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.genero is distinct from old.genero and exists(select 1 from public.monitoring_settings s
  where s.target=new.id::text and s.kind='schedule' and s.revoked_at is null and not(s.payload?'cycle') and s.payload->>'end'<s.payload->>'start') then
  update private.monitoring_revision set version=version+1 where id=true;
  update public.monitoring_results set dirty=true where active and employee_id=new.id;
  perform private.monitoring_enqueue(new.id);
 end if;
 return new;
end $$;
revoke all on function private.employee_gender_roster_changed() from public,anon,authenticated,service_role;
create trigger employee_gender_roster_changed after update of genero on public.colaboradores
 for each row execute function private.employee_gender_roster_changed();

select private.refresh_employee_sunday_references();
update private.monitoring_revision set version=version+1 where id=true;
update public.monitoring_results r set dirty=true where r.active and exists(
 select 1 from public.colaboradores c join public.monitoring_settings s on s.target=c.id::text
 where c.id=r.employee_id and c.genero is not null and s.kind='schedule' and s.revoked_at is null
 and not(s.payload?'cycle') and s.payload->>'end'<s.payload->>'start'
 and s.valid_from<=r.operational_date and coalesce(s.valid_to,'9999-12-31')>=r.operational_date);
insert into public.monitoring_jobs(employee_id,operational_date,reason)
 select distinct employee_id,operational_date,'Folgas por gênero confirmado e domingo sem ponto'
 from public.monitoring_results where active and dirty
on conflict(employee_id,operational_date) do update set reason=excluded.reason;
