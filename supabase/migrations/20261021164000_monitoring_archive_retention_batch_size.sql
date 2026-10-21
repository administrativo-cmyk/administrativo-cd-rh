-- Still below the existing 500-row restore/import bound; each page is hash-bound.
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.monitoring_archive_candidates(text)'::regprocedure);
 if strpos(definition,'limit 100')=0 then raise exception 'ARCHIVE_RETENTION_PATCH_CHANGED';end if;
 execute replace(definition,'limit 100','limit 500');
 definition:=pg_get_functiondef('private.monitoring_archive_worker_impl(text,jsonb)'::regprocedure);
 if strpos(definition,'expected not between 1 and 100')=0 then raise exception 'ARCHIVE_RETENTION_PATCH_CHANGED';end if;
 execute replace(definition,'expected not between 1 and 100','expected not between 1 and 500');
end $$;
