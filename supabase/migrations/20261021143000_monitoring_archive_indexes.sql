-- Apply after the verified working set is restored: do not build these on a full disk.
create index monitoring_events_device_time_access on public.monitoring_events(source_id,device,occurred_at) where event_type='access';
create index monitoring_archive_event_time on public.monitoring_events(occurred_at);
create index monitoring_archive_inactive_result on public.monitoring_results(computed_at,id) where not active;
create index monitoring_archive_audit_time on public.monitoring_audit(created_at);
do $$begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  perform cron.schedule('monitoring-archive-vacuum','15 4 * * *','vacuum (analyze) public.monitoring_events, public.monitoring_occurrences, public.monitoring_results, public.monitoring_jobs, public.monitoring_audit');
 end if;
end $$;
