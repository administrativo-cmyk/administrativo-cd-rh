alter function private.monitoring_worker_impl(text,jsonb) rename to monitoring_worker_before_shift_defer;
create function private.monitoring_worker_impl(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare until_at timestamptz;
begin
 if p_action<>'defer' then return private.monitoring_worker_before_shift_defer(p_action,p_data);end if;
 until_at:=(p_data->>'until')::timestamptz;
 if until_at is null or not isfinite(until_at) or until_at<=clock_timestamp() or until_at>clock_timestamp()+interval '25 hours' then raise exception 'MONITORING_DEFER_INVALID';end if;
 update public.monitoring_jobs set leased_until=until_at,lease_token=null,last_error='AWAITING_SHIFT_START'
  where employee_id=(p_data->>'employeeId')::uuid and operational_date=(p_data->>'date')::date and lease_token=(p_data->>'leaseToken')::uuid and leased_until>clock_timestamp();
 if not found then raise exception 'MONITORING_LEASE_LOST';end if;
 return '{"ok":true}';
end $$;
revoke all on function private.monitoring_worker_before_shift_defer(text,jsonb),private.monitoring_worker_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_worker_impl(text,jsonb) to service_role;
