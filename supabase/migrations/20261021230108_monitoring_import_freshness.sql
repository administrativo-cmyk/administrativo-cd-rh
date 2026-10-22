-- Preserve source watermarks when operational events leave the rolling window.
create table private.monitoring_import_progress (
 source_id text primary key references public.monitoring_sources(id) on delete cascade,
 last_import_at timestamptz,
 last_record_at timestamptz
);
alter table private.monitoring_import_progress enable row level security;
revoke all on private.monitoring_import_progress from public,anon,authenticated,service_role;

insert into private.monitoring_import_progress(source_id,last_import_at,last_record_at)
select s.id,
 greatest((select max(f.completed_at) from public.monitoring_files f where f.source_id=s.id and f.status='complete'),
          (select max(j.completed_at) from private.monitoring_cloud_jobs j where j.source_id=s.id and j.status='completed')),
 (select max(e.occurred_at) from public.monitoring_events e where e.source_id=s.id
  and ((s.kind='afd' and e.event_type='punch') or (s.kind='defense-access' and e.event_type='access')))
from public.monitoring_sources s where s.kind in('afd','defense-access');

create function private.monitoring_import_progress_touch() returns trigger
language plpgsql security definer set search_path='' as $$
declare imported_at timestamptz;record_at timestamptz;
begin
 if tg_table_name='monitoring_events' then
  if new.event_type not in('punch','access') then return new;end if;
  record_at:=new.occurred_at;
 else
  if new.status not in('complete','completed') or new.completed_at is null then return new;end if;
  imported_at:=new.completed_at;
 end if;
 insert into private.monitoring_import_progress as p(source_id,last_import_at,last_record_at)
 values(new.source_id,imported_at,record_at)
 on conflict(source_id) do update set
  last_import_at=greatest(p.last_import_at,excluded.last_import_at),
  last_record_at=greatest(p.last_record_at,excluded.last_record_at)
 where (excluded.last_import_at is not null and (p.last_import_at is null or excluded.last_import_at>p.last_import_at))
    or (excluded.last_record_at is not null and (p.last_record_at is null or excluded.last_record_at>p.last_record_at));
 return new;
end $$;
revoke all on function private.monitoring_import_progress_touch() from public,anon,authenticated,service_role;
create trigger monitoring_import_record_progress after insert or update of source_id,occurred_at,event_type
 on public.monitoring_events for each row execute function private.monitoring_import_progress_touch();
create trigger monitoring_import_file_progress after insert or update of status,completed_at
 on public.monitoring_files for each row execute function private.monitoring_import_progress_touch();
create trigger monitoring_import_cloud_progress after insert or update of status,completed_at
 on private.monitoring_cloud_jobs for each row execute function private.monitoring_import_progress_touch();

create function private.monitoring_import_freshness() returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('sourceId',s.id,'name',coalesce(nullif(btrim(s.label),''),
   case when s.kind='defense-access' then 'Faciais (Defense)' else s.id end),
   'kind',s.kind,'lastImportAt',p.last_import_at,'lastRecordAt',p.last_record_at)
   order by s.kind='defense-access',coalesce(s.label,s.id)),'[]')
 from public.monitoring_sources s left join private.monitoring_import_progress p on p.source_id=s.id
 where s.active and s.kind in('afd','defense-access')
$$;
revoke all on function private.monitoring_import_freshness() from public,anon,authenticated,service_role;

alter function private.monitoring_cloud_admin_impl(text,jsonb) rename to monitoring_cloud_admin_before_freshness;
create function private.monitoring_cloud_admin_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer jsonb;
begin
 -- The original action enforces approved ADMIN/RH access before any summary read.
 answer:=private.monitoring_cloud_admin_before_freshness(p_action,p_data);
 if p_action='list' then answer:=answer||jsonb_build_object('freshness',private.monitoring_import_freshness());end if;
 return answer;
end $$;
revoke all on function private.monitoring_cloud_admin_impl(text,jsonb),private.monitoring_cloud_admin_before_freshness(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_cloud_admin_impl(text,jsonb) to authenticated;
