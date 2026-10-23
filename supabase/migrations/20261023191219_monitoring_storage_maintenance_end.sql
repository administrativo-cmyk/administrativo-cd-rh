do $$begin
 perform pg_advisory_xact_lock(791704);perform pg_advisory_xact_lock(791705);
 update private.monitoring_archive_control set maintenance=false,updated_at=clock_timestamp() where id and maintenance;
 update private.monitoring_archive_retention set checked_at='-infinity',pending=true where id;
end $$;
notify pgrst,'reload schema';

-- Vacuum makes the rolling window's dead-row space reusable before the next
-- import. Include the private automatic caches in the existing nightly job.
do $$begin if to_regnamespace('cron') is not null then
 perform cron.schedule('monitoring-archive-vacuum','15 4 * * *',
  'vacuum (analyze) public.monitoring_events, public.monitoring_occurrences, public.monitoring_results, public.monitoring_jobs, public.monitoring_audit, private.daily_call_audit, private.daily_call_decisions');
end if;end $$;
