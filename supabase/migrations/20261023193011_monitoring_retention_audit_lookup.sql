-- Make the constant partial-index predicate explicit on the correlated side.
-- Equality to the outer action alone cannot prove membership for the planner.
do $$declare definition text;signature text;needle text;begin
 foreach signature in array array['private.monitoring_archive_candidates(text)','private.monitoring_archive_page_matches(text,jsonb)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:=case when signature like '%candidates%' then 'newer.action=a.action and newer.actor is null' else 'newer.action=y.action and newer.actor is null' end;
  if strpos(definition,needle)=0 then raise exception 'ARCHIVE_AUTO_INDEX_PATCH_CHANGED';end if;
  execute replace(definition,needle,needle||' and newer.action in (''DECISION'',''IMPORT'')');
 end loop;
end $$;
