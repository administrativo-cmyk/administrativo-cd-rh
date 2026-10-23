-- Read a full authorized summary in one SQL statement. Independent HTTP pages
-- cannot share an MVCC snapshot while the calculation worker publishes results.
-- Keep the existing 500-row RPC pages for callers that explicitly need a page.
-- This stores no per-query copies and does not lock or pause the worker.
do $$
declare definition text;needle text;replacement text;
begin
 perform set_config('lock_timeout','5s',true);
 definition:=replace(pg_get_functiondef('private.monitoring_query_before_group_observations(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 needle:='paged as (select * from filtered order by name,"employeeId",date limit least(coalesce((p_data->>''limit'')::int,50),500) offset greatest(coalesce((p_data->>''offset'')::int,0),0))';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'MONITORING_ATOMIC_SUMMARY_DEFINITION_CHANGED';end if;
 replacement:=$patch$paged as (
    select * from filtered
    where p_data->>'completeSnapshot' is distinct from 'true' or (select count(*) from filtered)<=200000
    order by name,"employeeId",date
    limit case when p_data->>'completeSnapshot'='true' then 200000 else least(coalesce((p_data->>'limit')::int,50),500) end
    offset case when p_data->>'completeSnapshot'='true' then 0 else greatest(coalesce((p_data->>'offset')::int,0),0) end
   )$patch$;
 execute replace(definition,needle,replacement);
end $$;
