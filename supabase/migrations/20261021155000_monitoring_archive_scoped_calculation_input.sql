-- The engine already selects individual settings by employee. Do that before
-- transporting a worker/history snapshot, retaining all shared area/group rules.
alter function private.monitoring_input(uuid,date,date) rename to monitoring_input_before_employee_scope;
create function private.monitoring_input(employee uuid,start_date date,end_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare answer jsonb; settings jsonb;
begin
 answer:=private.monitoring_input_before_employee_scope(employee,start_date,end_date);
 select coalesce(jsonb_agg(s order by ordinal),'[]') into settings from jsonb_array_elements(answer->'settings') with ordinality x(s,ordinal)
  where (s->>'kind' not in ('schedule','group_snapshot','evidence','manual_event','user_link') or s->>'target'=employee::text)
   and (s->>'kind'<>'policy' or coalesce(s#>>'{payload,scope}','')<>'person' or s->>'target'=employee::text);
 return jsonb_set(answer,'{settings}',settings);
end $$;
revoke all on function private.monitoring_input_before_employee_scope(uuid,date,date),private.monitoring_input(uuid,date,date) from public,anon,authenticated,service_role;
