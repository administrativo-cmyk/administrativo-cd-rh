do $$begin
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(791704);
 if exists(select 1 from private.monitoring_cloud_jobs where status in('uploading','queued','processing')) then
  raise exception 'INCREMENTAL_IMPORTS_ACTIVE';
 end if;
end $$;

-- Ignore the current in-flight file when comparing persistent coverage blockers.
-- A new unreadable/conflicting file or a resolved attempt can change absence
-- evidence for the declared coverage even when no canonical event changed.
create function private.monitoring_import_coverage_blocked(p_source text,p_exclude_file uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.monitoring_files f where f.source_id=p_source
   and (p_exclude_file is null or f.id<>p_exclude_file)
   and (f.status<>'complete' or f.rejected_rows>0 or f.conflict_rows>0))
  or exists(select 1 from public.monitoring_attempts a where a.source_id=p_source and not exists(
   select 1 from public.monitoring_files recovered where recovered.source_id=a.source_id
    and recovered.relative_path=a.relative_path and recovered.status='complete'
    and recovered.rejected_rows=0 and recovered.conflict_rows=0 and recovered.completed_at>=a.created_at))
$$;
revoke all on function private.monitoring_import_coverage_blocked(text,uuid) from public,anon,authenticated,service_role;

do $$
declare definition text;needle text;replacement text;
begin
 definition:=replace(pg_get_functiondef('private.monitoring_ingest_before_source_management(jsonb)'::regprocedure),E'\r\n',E'\n');
 needle:='v_batch_event_ids uuid[]:=array[]::uuid[];';
 if strpos(definition,needle)=0 then raise exception 'INCREMENTAL_DECLARATION_CHANGED';end if;
 definition:=replace(definition,needle,needle||' v_event_changed boolean; v_coverage_was_blocked boolean; v_coverage_changed boolean:=false;');

 needle:=' perform 1 from public.monitoring_files where id=f for update;';
 if strpos(definition,needle)=0 then raise exception 'INCREMENTAL_FILE_LOCK_CHANGED';end if;
 definition:=replace(definition,needle,needle||$patch$
 if exists(select 1 from public.monitoring_sources where id=s and kind='afd'
  and configuration->>'sourceIdentityConfirmed'='true' and configuration#>>'{declaredCoverage,continuous}'='true') then
  v_coverage_was_blocked:=private.monitoring_import_coverage_blocked(s,f);
 end if;$patch$);

 needle:='v_event:=null; v_conflict:=false; e:=o->''event'';';
 if strpos(definition,needle)=0 then raise exception 'INCREMENTAL_EVENT_RESET_CHANGED';end if;
 definition:=replace(definition,needle,'v_event:=null; v_conflict:=false; v_event_changed:=false; e:=o->''event'';');
 needle:='if found then v_refined:=v_refined+1;end if;';
 if strpos(definition,needle)=0 then raise exception 'INCREMENTAL_REFINEMENT_CHANGED';end if;
 definition:=replace(definition,needle,'if found then v_refined:=v_refined+1;v_event_changed:=true;end if;');
 needle:='if v_conflict then update public.monitoring_events set conflicted=true,eligible=false where id=v_event; v_conflicts:=v_conflicts+1; end if;';
 if strpos(definition,needle)=0 then raise exception 'INCREMENTAL_CONFLICT_CHANGED';end if;
 definition:=replace(definition,needle,$patch$if v_conflict then
    update public.monitoring_events set conflicted=true,eligible=false where id=v_event and (not conflicted or eligible);
    if found then v_event_changed:=true;end if;
    v_conflicts:=v_conflicts+1;
   end if;$patch$);
 needle:='else v_new:=v_new+1; end if;';
 if strpos(definition,needle)=0 then raise exception 'INCREMENTAL_INSERT_CHANGED';end if;
 definition:=replace(definition,needle,'else v_new:=v_new+1;v_event_changed:=true;end if;');
 needle:='if v_event is not null then v_batch_event_ids:=array_append(v_batch_event_ids,v_event);end if;';
 if strpos(definition,needle)=0 then raise exception 'INCREMENTAL_EVENT_LIST_CHANGED';end if;
 definition:=replace(definition,needle,'if v_event_changed then v_batch_event_ids:=array_append(v_batch_event_ids,v_event);end if;');
 needle:='if v_new>0 or v_conflicts>0 or v_refined>0 then';
 if strpos(definition,needle)=0 then raise exception 'INCREMENTAL_INVALIDATION_CHANGED';end if;
 definition:=replace(definition,needle,'if cardinality(v_batch_event_ids)>0 then');

 needle:=$old$if (p_data#>>'{batch,final}')::boolean and exists(select 1 from public.monitoring_files where id=f and status in ('complete','conflict')) then$old$;
 if strpos(definition,needle)=0 then raise exception 'INCREMENTAL_COVERAGE_CHANGED';end if;
 definition:=replace(definition,needle,needle||$patch$
  if v_coverage_was_blocked is not null then
   v_coverage_changed:=v_coverage_was_blocked is distinct from private.monitoring_import_coverage_blocked(s);
  end if;$patch$);
 needle:=$old$and src.configuration->>'sourceIdentityConfirmed'='true' and src.configuration#>>'{declaredCoverage,continuous}'='true'$old$;
 if strpos(definition,needle)=0 then raise exception 'INCREMENTAL_COVERAGE_FILTER_CHANGED';end if;
 definition:=replace(definition,needle,needle||$patch$
   -- Clean historical days survive ordinary exports. Initial missing days,
   -- invalidated days and genuinely changed absence evidence still get work.
   and (v_coverage_changed or not exists(select 1 from public.monitoring_results r
    where r.employee_id=b.employee_id and r.operational_date=d::date and r.active and not r.dirty))$patch$);
 execute definition;
end $$;

-- Advancing the import time cannot change readiness outside explicit continuous
-- punch coverage, or after that entire coverage was already ready.
do $$declare definition text;needle text;begin
 definition:=replace(pg_get_functiondef('private.daily_call_source_ready()'::regprocedure),E'\r\n',E'\n');
 needle:='  -- Neighboring days preserve overnight windows and the existing +/-1 rule.';
 if strpos(definition,needle)=0 then raise exception 'INCREMENTAL_READINESS_CHANGED';end if;
 definition:=replace(definition,needle,$patch$
  if new.configuration->>'sourceIdentityConfirmed' is distinct from 'true'
   or new.configuration#>>'{declaredCoverage,continuous}' is distinct from 'true'
   or old.last_success_at>=(new.configuration#>>'{declaredCoverage,to}')::timestamptz then return new;end if;
$patch$||needle);
 execute definition;
end $$;
