-- pg_cron requires its supported function; direct writes to cron.job are denied.
do $$
declare definition text; needle text:=$old$execute 'update cron.job set active=false where jobname=''monitoring-cloud-dispatch''';$old$;
 replacement text:=$new$execute 'select cron.alter_job(jobid,active := false) from cron.job where jobname=''monitoring-cloud-dispatch''';$new$;
begin
 definition:=pg_get_functiondef('private.monitoring_archive_worker_impl(text,jsonb)'::regprocedure);
 if strpos(definition,needle)>0 then execute replace(definition,needle,replacement);
 elsif strpos(definition,replacement)=0 then raise exception 'ARCHIVE_SCHEDULER_PATCH_CHANGED';end if;
end $$;
