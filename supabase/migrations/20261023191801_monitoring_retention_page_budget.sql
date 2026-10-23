-- Materialize missing group-file evidence once per page, not once per access.
-- Bounded 2,000-row pages reduce cloud round trips without bypassing reread/hash
-- verification or the concurrent-manual-decision checks at commit time.
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.monitoring_archive_candidates(text)'::regprocedure);
 needle:='with ranked as materialized (';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_PAGE_BUDGET_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,$patch$with unmaterialized as materialized (
   select distinct o.event_id from public.monitoring_occurrences o join public.monitoring_events ev on ev.id=o.event_id
    left join private.monitoring_group_files gf on gf.file_id=o.file_id where ev.event_type='access' and gf.file_id is null
  ), ranked as materialized ($patch$);
 needle:='join public.monitoring_sources s on s.id=e.source_id';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_PAGE_BUDGET_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,needle||' left join unmaterialized u on u.event_id=e.id');
 needle:='private.monitoring_archive_access_materialized(e.id)';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_PAGE_BUDGET_PATCH_CHANGED';end if;
 definition:=replace(definition,needle,'(u.event_id is null)');
 definition:=replace(definition,'limit 500','limit 2000');execute definition;
 definition:=pg_get_functiondef('private.monitoring_archive_worker_before_details(text,jsonb)'::regprocedure);
 needle:='expected not between 1 and 500';
 if strpos(definition,needle)=0 then raise exception 'ARCHIVE_PAGE_BUDGET_PATCH_CHANGED';end if;
 execute replace(definition,needle,'expected not between 1 and 2000');
end $$;
