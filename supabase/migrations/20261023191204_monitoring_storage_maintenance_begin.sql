-- One-time physical reclamation. Fresh databases have no active archive and
-- need no maintenance window; live archives must have no leased/import work.
do $$declare c private.monitoring_archive_control;begin
 perform pg_advisory_xact_lock(791704);perform pg_advisory_xact_lock(791705);
 select * into c from private.monitoring_archive_control where id for update;
 if not c.active then return;end if;
 if c.maintenance or c.run_id is null then raise exception 'ARCHIVE_STATE';end if;
 if exists(select 1 from public.monitoring_jobs)
  or exists(select 1 from private.monitoring_cloud_jobs where status not in ('completed','cancelled','failed')) then raise exception 'ARCHIVE_WORK_PENDING';end if;
 update private.monitoring_archive_control set maintenance=true,updated_at=clock_timestamp() where id;
end $$;
