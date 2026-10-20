-- The main entrance is an access-control observation, not an individually
-- measured perimeter. Project historical quality without rewriting its evidence.
create function private.monitoring_operational_summary(p_summary jsonb,p_result jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
 operation_quality text:=p_result#>>'{outsideOperation,quality}';
 cafeteria_quality text:=p_result#>>'{cafeteria,quality}';
 lateness_quality text:=p_result#>>'{lateness,quality}';
 journey_status text:=p_result#>>'{journey,status}';
 has_known boolean;
 quality text;
begin
 if p_summary is null or jsonb_typeof(p_summary)<>'object' then return p_summary; end if;
 -- Older/incomplete envelopes retain their existing quality; missing evidence
 -- must never promote a row to complete.
 if operation_quality is null or operation_quality not in ('complete','partial','unavailable','excluded')
  or cafeteria_quality is null or cafeteria_quality not in ('complete','partial','unavailable','excluded')
  or lateness_quality is null or lateness_quality not in ('complete','partial','unavailable','excluded')
  or journey_status is null then
  return p_summary||jsonb_build_object('outsideCdSeconds',null);
 end if;
 has_known:=p_result->>'workMs' is not null
  or p_result#>>'{outsideOperation,milliseconds}' is not null
  or p_result#>>'{cafeteria,milliseconds}' is not null
  or p_result#>>'{lateness,totalMs}' is not null;
 quality:=case
  when operation_quality='excluded' then 'excluded'
  when not has_known then 'unavailable'
  when journey_status<>'complete'
   or operation_quality in ('partial','unavailable')
   or cafeteria_quality in ('partial','unavailable')
   or lateness_quality='unavailable' then 'partial'
  else 'complete' end;
 return p_summary||jsonb_build_object('quality',quality,'outsideCdSeconds',null);
end $$;
revoke all on function private.monitoring_operational_summary(jsonb,jsonb)
 from public,anon,authenticated,service_role;

-- Keep the existing authorization, scope and pagination chain. Project before
-- quality filtering and totals, including the detail summary returned by RPC.
do $$declare definition text; target text;
 row_target text:='r.operational_date as date,r.summary,r.dirty';
 quality_target text:='else r.summary->>''quality'' end as quality';
 detail_target text:='''summary'',r.summary,''dirty''';
begin
 definition:=pg_get_functiondef('private.monitoring_query_before_group_observations(text,jsonb)'::regprocedure);
 foreach target in array array[row_target,quality_target,detail_target] loop
  if (length(definition)-length(replace(definition,target,'')))/length(target)<>1 then
   raise exception 'OPERATIONAL_QUALITY_PATCH_TARGET_CHANGED';
  end if;
 end loop;
 definition:=replace(definition,row_target,
  'r.operational_date as date,private.monitoring_operational_summary(r.summary,r.result) as summary,r.dirty');
 definition:=replace(definition,quality_target,
  'else private.monitoring_operational_summary(r.summary,r.result)->>''quality'' end as quality');
 definition:=replace(definition,detail_target,
  '''summary'',private.monitoring_operational_summary(r.summary,r.result),''dirty''');
 execute definition;
end $$;

-- Invalidate an in-flight multi-page query without dirtying or enqueueing history.
update private.monitoring_revision set results_version=results_version+1 where id=true;
