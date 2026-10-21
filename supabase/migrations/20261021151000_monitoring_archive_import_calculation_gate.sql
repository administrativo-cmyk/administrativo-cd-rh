-- Avoid producing obsolete result revisions between successive import batches.
-- Explicit ADMIN/RH recalculation and corrections keep their existing paths.
alter function private.monitoring_worker_impl(text,jsonb) rename to monitoring_worker_before_import_gate;
create function private.monitoring_worker_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if p_action='claim' and (select active from private.monitoring_archive_control where id)
  and exists(select 1 from private.monitoring_cloud_jobs where status in ('queued','processing')) then
  return jsonb_build_object('jobs','[]'::jsonb,'pending',(select count(*) from public.monitoring_jobs),'waitingForImport',true);
 end if;
 return private.monitoring_worker_before_import_gate(p_action,p_data);
end $$;
revoke all on function private.monitoring_worker_before_import_gate(text,jsonb),private.monitoring_worker_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_worker_impl(text,jsonb) to service_role;
