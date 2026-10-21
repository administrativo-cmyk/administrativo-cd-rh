-- Keep Defense group-change evidence, while moving repeated raw cells to the
-- already verified original/snapshot. Canonical access events remain unchanged.
create function private.monitoring_archive_compact_payload(p_kind text,p_row jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when coalesce(p_kind,'') not in ('afd','defense-access') then p_row else
  jsonb_build_object('issues',coalesce((select jsonb_agg(i) from jsonb_array_elements(coalesce(p_row->'issues','[]')) i where i->>'severity'='error'),'[]'::jsonb),'originalPreserved',true)
  ||case when p_row->'event' is null or p_row->'event'='null'::jsonb then '{}'::jsonb when p_kind='afd' then '{"event":true}'::jsonb
   else jsonb_build_object('event',jsonb_build_object('identity',p_row#>'{event,identity}',
    'original',jsonb_build_object('name',p_row#>'{event,original,name}','groups',p_row#>'{event,original,groups}'))) end end
$$;
revoke all on function private.monitoring_archive_compact_payload(text,jsonb) from public,anon,authenticated,service_role;
create or replace function private.monitoring_archive_occurrence_payload(p_source text,p_row jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select case when (select active from private.monitoring_archive_control where id) then
  private.monitoring_archive_compact_payload((select kind from public.monitoring_sources where id=p_source),p_row) else p_row end
$$;
do $$declare c private.monitoring_archive_control;s private.monitoring_archive_snapshots;t text;n bigint;begin
 select * into c from private.monitoring_archive_control where id;
 if not c.maintenance then return;end if;
 select * into strict s from private.monitoring_archive_snapshots where id=c.run_id;
 if s.state<>'rebuilding' or s.manifest_path is null then raise exception 'ARCHIVE_STATE';end if;
 foreach t in array array['public.monitoring_events','public.monitoring_occurrences','public.monitoring_results','public.monitoring_jobs'] loop
  execute format('select count(*) from %s',t::regclass) into n;
  if n is distinct from (s.metadata#>>array['rebuild','tableCounts',t])::bigint then raise exception 'ARCHIVE_RESTORE_INCOMPLETE';end if;
 end loop;
 perform pg_advisory_xact_lock(791704);perform set_config('app.monitoring_archive_bypass',c.run_id::text,true);
 update public.monitoring_occurrences o set payload=private.monitoring_archive_compact_payload('defense-access',o.payload)
  from public.monitoring_files f join public.monitoring_sources src on src.id=f.source_id where o.file_id=f.id and src.kind='defense-access';
 update private.monitoring_archive_snapshots set metadata=metadata||'{"accessProvenanceCompacted":true}'::jsonb where id=c.run_id;
end $$;
