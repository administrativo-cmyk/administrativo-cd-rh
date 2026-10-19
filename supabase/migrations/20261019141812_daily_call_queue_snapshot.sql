-- The period queue is a read model, not a second execution of every attendance decision.
-- Resolve and close continue using fresh evidence and their existing locks/version checks.
create function private.daily_call_queue_evidence(p_employee uuid,p_date date) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when d.input_version is not null and jsonb_typeof(d.decision->'blockers')='array'
  and not exists(select 1 from public.monitoring_jobs j where j.employee_id=p_employee and j.operational_date=p_date)
  and not exists(select 1 from public.monitoring_results r where r.employee_id=p_employee and r.operational_date=p_date and r.active and r.dirty)
 then d.decision
 else jsonb_build_object('state','blocked','status',null,'balanceMinutes',d.decision->'balanceMinutes','blockers',(case when jsonb_typeof(d.decision->'blockers')='array' then d.decision->'blockers' else '[]'::jsonb end)||jsonb_build_array('IMPORT_REPROCESS_PENDING')) end
 from (values(1)) anchor(n) left join private.daily_call_decisions d on d.employee_id=p_employee and d.operational_date=p_date
$$;
revoke all on function private.daily_call_queue_evidence(uuid,date) from public,anon,authenticated,service_role;
do $migration$
declare definition text; needle text:='private.daily_call_evidence(c.id,d::date)';queue_needle text:='private.daily_call_rows(v_start,v_end,v_filter,p_data?''managerId'',v_role,v_manager)';
begin
 definition:=pg_get_functiondef('private.daily_call_rows(date,date,uuid,boolean,public.papel_usuario,uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'QUEUE_ROWS_DEFINITION_CHANGED';end if;
 definition:=replace(definition,'private.daily_call_rows(','private.daily_call_cached_rows(');
 execute replace(definition,needle,'private.daily_call_queue_evidence(c.id,d::date)');
 definition:=pg_get_functiondef('private.daily_call_workflow_impl(text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,queue_needle,'')))/length(queue_needle)<>1 then raise exception 'QUEUE_WORKFLOW_DEFINITION_CHANGED';end if;
 execute replace(definition,queue_needle,'private.daily_call_queue_rows(v_start,v_end,v_filter,p_data?''managerId'',v_role,v_manager)');
end;
$migration$;


create function private.daily_call_queue_rows(p_start date,p_end date,p_manager uuid,p_filter_manager boolean,p_role public.papel_usuario,p_actor_manager uuid)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_start=p_end then return query select * from private.daily_call_rows(p_start,p_end,p_manager,p_filter_manager,p_role,p_actor_manager);
 else return query select * from private.daily_call_cached_rows(p_start,p_end,p_manager,p_filter_manager,p_role,p_actor_manager);end if;
end $$;
revoke all on function private.daily_call_cached_rows(date,date,uuid,boolean,public.papel_usuario,uuid),private.daily_call_queue_rows(date,date,uuid,boolean,public.papel_usuario,uuid) from public,anon,authenticated,service_role;
