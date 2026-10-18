-- Read-only, scoped history. No grant on the underlying audit tables.
create function private.audit_redact(p_value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; item record; text_value text;
begin
 if p_value is null then return null; end if;
 if jsonb_typeof(p_value)='object' then
  result:='{}';
  for item in select key,value from jsonb_each(p_value) loop
   if item.key ~* '(password|senha|secret|token|credential|base64|bytes|payload|blob|cookie|authorization)' then
    result:=result||jsonb_build_object(item.key,'[restrito]');
   elsif item.key ~* '(cpf|pis|identity.?value)' then
    result:=result||jsonb_build_object(item.key,'[identificador protegido]');
   else result:=result||jsonb_build_object(item.key,private.audit_redact(item.value)); end if;
  end loop;
  return result;
 elsif jsonb_typeof(p_value)='array' then
  select coalesce(jsonb_agg(private.audit_redact(value) order by ord),'[]') into result from jsonb_array_elements(p_value) with ordinality a(value,ord);
  return result;
 elsif jsonb_typeof(p_value)='string' then
  text_value:=p_value#>>'{}';
  text_value:=regexp_replace(text_value,'\m[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}\M','[identificador protegido]','g');
  return to_jsonb(left(text_value,4000));
 end if;
 return p_value;
end $$;
revoke all on function private.audit_redact(jsonb) from public,anon,authenticated,service_role;

create index administration_audit_created on private.administration_audit(created_at desc,id desc);
create index time_bank_measurement_audit_created on private.time_bank_measurement_audit(created_at desc,id desc);
create index workspace_audit_created on private.workspace_audit(created_at desc,id desc);
create index monitoring_audit_created on public.monitoring_audit(created_at desc,id desc);
create index daily_call_audit_created on private.daily_call_audit(created_at desc,id desc);
create index daily_call_attachment_audit_created on private.daily_call_attachment_audit(created_at desc,id desc);
create index user_edit_audit_created on private.user_edit_audit(created_at desc,id desc);
create index chamada_diaria_auditoria_created on public.chamada_diaria_auditoria(alterado_em desc,id);
create index perfis_gestor_auditoria_created on private.perfis_gestor_auditoria(alterado_em desc,id);

create view private.audit_history_records with(security_invoker=true) as
 select 'administration:'||id::text id,'cadastros'::text domain,entity,entity_id::text record_id,action,actor,created_at,reason,before_record before_value,after_record after_value,
 case when entity='employee' then entity_id when entity='vacation' and after_record->>'colaborador_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then (after_record->>'colaborador_id')::uuid end employee_id
 from private.administration_audit
 union all select 'bank:'||a.id,'banco_horas','measurement',a.measurement_id::text,a.action,a.actor,a.created_at,a.reason,a.before_record,a.after_record,m.colaborador_id from private.time_bank_measurement_audit a join public.banco_horas_medicoes m on m.id=a.measurement_id
 union all select 'user:'||id,'usuarios','user',user_id::text,'update',actor,created_at,reason,before_record,after_record,null::uuid from private.user_edit_audit
 union all select 'workspace:'||id,'workspace','workspace',record_id::text,action,actor,created_at,reason,before_record,after_record,null::uuid from private.workspace_audit
 union all select 'monitoring:'||a.id,'monitoramento','monitoring',a.target,a.action,a.actor,a.created_at,a.detail->>'reason',a.detail->'before',case when a.detail?'after' then a.detail->'after' else a.detail-'before' end,
 coalesce(b.employee_id,mc.id,case when a.detail->>'employeeId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then (a.detail->>'employeeId')::uuid end)
 from public.monitoring_audit a left join public.monitoring_bindings b on b.id::text=a.target
 left join public.monitoring_settings s on s.id::text=a.target
 left join public.colaboradores mc on mc.id::text=case when a.action='reprocess' then a.target when s.kind in ('schedule','group_snapshot','evidence','manual_event','user_link') or (s.kind='policy' and s.payload->>'scope'='person') then s.target end
 union all select 'daily:'||id,'chamada','daily_call',coalesce(employee_id::text,'dia')||':'||operational_date,action,actor,created_at,reason,before_value,after_value,employee_id from private.daily_call_audit
 union all select 'daily-legacy:'||id,'chamada','daily_call',chamada_id::text,operacao,alterado_por,alterado_em,null::text,jsonb_build_object('status',status_anterior,'observacao',observacao_anterior,'data',data),jsonb_build_object('status',status_novo,'observacao',observacao_nova,'data',data),colaborador_id from public.chamada_diaria_auditoria
 union all select 'attachment:'||id,'anexos','attachment',attachment_id::text,action,actor,created_at,reason,null::jsonb,metadata,employee_id from private.daily_call_attachment_audit
 union all select 'manager-access:'||id,'usuarios','user_manager',usuario_id::text,'manager_link',alterado_por,alterado_em,null::text,jsonb_build_object('gestor_id',gestor_anterior_id),jsonb_build_object('gestor_id',gestor_novo_id),null::uuid from private.perfis_gestor_auditoria;
revoke all on private.audit_history_records from public,anon,authenticated,service_role;

create function private.audit_history_impl(p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare role public.papel_usuario; start_day date; end_day date; snapshot timestamptz; page_offset integer; page_limit integer;
 query_text text:=btrim(coalesce(p_data->>'query','')); domain_filter text:=coalesce(p_data->>'domain',''); actor_filter uuid; action_filter text:=btrim(coalesce(p_data->>'action','')); result jsonb;
begin
 select papel_usuario into role from public.perfis where id=(select auth.uid()) and status_usuario='APROVADO';
 if role is null or role not in ('ADMIN','RH') then raise exception using errcode='42501',message='AUDIT_FORBIDDEN'; end if;
 begin
  start_day:=coalesce((p_data->>'from')::date,(now() at time zone 'America/Sao_Paulo')::date-30);
  end_day:=coalesce((p_data->>'to')::date,(now() at time zone 'America/Sao_Paulo')::date);
  snapshot:=coalesce((p_data->>'snapshot')::timestamptz,clock_timestamp());
  page_offset:=coalesce((p_data->>'offset')::integer,0); page_limit:=coalesce((p_data->>'limit')::integer,50);
  actor_filter:=nullif(p_data->>'actor','')::uuid;
 exception when others then raise exception using errcode='22023',message='AUDIT_INVALID'; end;
 if not isfinite(start_day) or not isfinite(end_day) or not isfinite(snapshot) or end_day<start_day or end_day-start_day>366 or page_offset<0 or page_offset>100000 or page_limit<1 or page_limit>100 or length(query_text)>120 or length(action_filter)>100 or snapshot>clock_timestamp()+interval '5 seconds' or domain_filter not in ('','cadastros','banco_horas','usuarios','workspace','monitoramento','chamada','anexos') then
  raise exception using errcode='22023',message='AUDIT_INVALID';
 end if;
 with filtered as materialized (
  select h.*,p.nome_completo actor_name,c.nome employee_name,c.matricula employee_number
  from private.audit_history_records h left join public.perfis p on p.id=h.actor left join public.colaboradores c on c.id=h.employee_id
  where h.created_at >= (start_day::timestamp at time zone 'America/Sao_Paulo') and h.created_at < ((end_day+1)::timestamp at time zone 'America/Sao_Paulo') and h.created_at<=snapshot
   and (role='ADMIN' or h.domain not in ('usuarios','workspace'))
   and (domain_filter='' or h.domain=domain_filter) and (actor_filter is null or h.actor=actor_filter)
   and (action_filter='' or h.action=action_filter)
   and (query_text='' or position(lower(query_text) in lower(concat_ws(' ',h.record_id,h.entity,p.nome_completo,c.nome,c.matricula)))>0)
 ), page as (select * from filtered order by created_at desc,id desc limit page_limit offset page_offset)
 select jsonb_build_object('total',(select count(*) from filtered),'offset',page_offset,'limit',page_limit,'snapshot',snapshot,'rows',coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'domain',domain,'entity',entity,'recordId',private.audit_redact(to_jsonb(record_id)),'action',action,'actorId',actor,'actorName',actor_name,'createdAt',created_at,
  'reason',private.audit_redact(to_jsonb(reason)),'before',private.audit_redact(before_value),'after',private.audit_redact(after_value),'employeeId',employee_id,'employeeName',employee_name,'employeeNumber',employee_number
 ) order by created_at desc,id desc),'[]')) into result from page;
 return result;
end $$;
revoke all on function private.audit_history_impl(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.audit_history_impl(jsonb) to authenticated;
create function public.audit_history(p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.audit_history_impl(p_data) $$;
revoke all on function public.audit_history(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.audit_history(jsonb) to authenticated;
