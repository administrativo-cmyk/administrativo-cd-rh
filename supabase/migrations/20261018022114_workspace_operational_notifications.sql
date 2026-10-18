-- Existing notices/vacation notifications remain intact. Operational alerts are derived,
-- not persisted attendance decisions and never infer a device failure or employee absence.
alter function private.workspace_notifications(uuid,public.papel_usuario,uuid) rename to workspace_notifications_before_operations;
create function private.workspace_notifications(p_actor uuid,p_role public.papel_usuario,p_manager uuid)
returns table(key text,title text,body text,href text,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select * from private.workspace_notifications_before_operations(p_actor,p_role,p_manager)
 union all
 select 'daily:'||d.operational_date::text||':'||coalesce(c.gestor_id::text,'none')||':'||md5(string_agg(d.employee_id::text||':'||d.version::text,'|' order by d.employee_id)),
 'Chamada com revisão pendente',count(*)::text||' decisão(ões) registrada(s) aguardam conferência em '||to_char(d.operational_date,'DD/MM/YYYY')||'. Consulte os bloqueios antes de decidir; a pendência não comprova falta.',
 '/chamada-diaria',max(d.updated_at)
 from private.daily_call_decisions d join public.colaboradores c on c.id=d.employee_id
 where p_role in ('ADMIN','RH','GESTOR') and (p_role<>'GESTOR' or (p_manager is not null and c.gestor_id=p_manager))
 and d.operational_date<(now() at time zone 'America/Sao_Paulo')::date and d.decision->>'state' in ('blocked','pending_manager')
 and not d.manual_override and c.ativo_no_sistema and c.situacao in ('ATIVO','FERIAS','NOVO_ADMITIDO')
 and not exists(select 1 from public.chamada_diaria cd where cd.colaborador_id=d.employee_id and cd.data=d.operational_date and cd.origin='manual')
 group by d.operational_date,c.gestor_id
 union all
 select 'import:'||s.id||':'||coalesce(s.last_success_at::text,'never')||':'||case when s.worker_state='error' then 'error' else 'stale' end,
 case when s.worker_state='error' then 'Importação precisa de conferência' when s.last_success_at is null then 'Fonte sem importação concluída' else 'Sem importação recente' end,
 'Fonte '||coalesce(nullif(s.label,''),s.id)||'. '||case when s.worker_state='error' then 'O coletor informou erro. Consulte o diagnóstico da importação.'
 when s.last_success_at is null then 'Ainda não há arquivo concluído registrado.' else 'Não há conclusão registrada nas últimas 24 horas. Confira a rotina prevista.' end||' Este aviso não comprova falha do relógio, cobertura de coleta ou ausência de colaborador.',
 '/monitoramento?tab=importacao',case when s.worker_state='error' then coalesce(s.heartbeat_at,s.created_at)
  when s.last_success_at is null then s.created_at else s.last_success_at+interval '24 hours' end
 from public.monitoring_sources s where p_role in ('ADMIN','RH') and s.active
 and (s.worker_state='error' or s.last_success_at is null or s.last_success_at<now()-interval '24 hours')
$$;
revoke all on function private.workspace_notifications(uuid,public.papel_usuario,uuid) from public,anon,authenticated,service_role;

alter function private.workspace_impl(text,jsonb) rename to workspace_before_operations;
revoke all on function private.workspace_before_operations(text,jsonb) from public,anon,authenticated,service_role;
create function private.workspace_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); profile public.perfis; item jsonb; old private.workspace_notification_state; n_key text; op text;
 result jsonb; v_offset integer:=coalesce((p_data->>'offset')::integer,0);v_limit integer:=coalesce((p_data->>'limit')::integer,25);
 include_archived boolean:=coalesce((p_data->>'includeArchived')::boolean,false);unread_only boolean:=coalesce((p_data->>'unreadOnly')::boolean,false);
 query text:=coalesce(btrim(p_data->>'query'),'');kind text:=coalesce(p_data->>'type','all');start_date date:=(p_data->>'start')::date;end_date date:=(p_data->>'end')::date;
begin
 if p_action not in ('notifications','notification_summary','notification_state_batch','notices') then return private.workspace_before_operations(p_action,p_data); end if;
 select * into profile from public.perfis where id=actor and status_usuario='APROVADO' for update;
 if actor is null or profile.papel_usuario is null then raise exception using errcode='42501',message='WORKSPACE_FORBIDDEN'; end if;
 if v_offset<0 or v_offset>100000 or v_limit not between 1 and 100 or length(query)>200 or kind not in ('all','notice','vacation','daily','import')
 or (start_date is not null and not isfinite(start_date)) or (end_date is not null and not isfinite(end_date)) or start_date>end_date then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
 if p_action='notification_state_batch' then
  op:=p_data->>'operation';
  if op is null or op not in ('read','unread','archive','restore') or jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 100 then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
  if exists(select 1 from jsonb_array_elements(p_data->'items') x group by x->>'key' having count(*)>1) then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
  for item in select value from jsonb_array_elements(p_data->'items') order by value->>'key' loop
   n_key:=item->>'key';
   if not exists(select 1 from private.workspace_notifications(actor,profile.papel_usuario,profile.gestor_id) n where n.key=n_key) then raise exception 'WORKSPACE_NOT_FOUND'; end if;
   select * into old from private.workspace_notification_state where user_id=actor and notification_key=n_key for update;
   if not(item?'expectedUpdatedAt') or old.updated_at is distinct from (item->>'expectedUpdatedAt')::timestamptz then raise exception 'WORKSPACE_STALE'; end if;
   insert into private.workspace_notification_state(user_id,notification_key,read_at,archived_at)
   values(actor,n_key,case when op='read' then clock_timestamp() when op='unread' then null else old.read_at end,
    case when op='archive' then clock_timestamp() when op='restore' then null else old.archived_at end)
   on conflict(user_id,notification_key) do update set read_at=excluded.read_at,archived_at=excluded.archived_at;
  end loop;
  return jsonb_build_object('changed',jsonb_array_length(p_data->'items'));
 end if;
 if p_action='notices' then
  if profile.papel_usuario not in ('ADMIN','RH') then raise exception using errcode='42501',message='WORKSPACE_FORBIDDEN'; end if;
  with eligible as (select * from private.workspace_notices n where (include_archived or n.archived_at is null)
   and (profile.papel_usuario='ADMIN' or n.audience_role is distinct from 'ADMIN')
   and (query='' or position(lower(query) in lower(n.title||' '||n.body))>0)
   and (start_date is null or (n.updated_at at time zone 'America/Sao_Paulo')::date>=start_date)
   and (end_date is null or (n.updated_at at time zone 'America/Sao_Paulo')::date<=end_date)),
  page as (select * from eligible order by created_at desc,id limit v_limit offset v_offset)
  select jsonb_build_object('total',(select count(*) from eligible),'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'audienceRole',audience_role,'managerId',manager_id,'createdAt',created_at,'updatedAt',updated_at,'archivedAt',archived_at)) from page),'[]'::jsonb),
   'managers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',nome) order by nome),'[]'::jsonb) from public.gestores where ativo)) into result;
  return result;
 end if;
 with available as (select n.*,s.read_at,s.archived_at,s.updated_at from private.workspace_notifications(actor,profile.papel_usuario,profile.gestor_id) n left join private.workspace_notification_state s on s.user_id=actor and s.notification_key=n.key),
 filtered as (select * from available where (include_archived or archived_at is null) and (not unread_only or read_at is null)
  and (kind='all' or split_part(key,':',1)=kind) and (query='' or position(lower(query) in lower(title||' '||body))>0)
  and (start_date is null or (created_at at time zone 'America/Sao_Paulo')::date>=start_date)
  and (end_date is null or (created_at at time zone 'America/Sao_Paulo')::date<=end_date)),
 page as (select * from filtered order by created_at desc,key limit case when p_action='notification_summary' then 0 else v_limit end offset v_offset)
 select jsonb_build_object('unread',(select count(*) from available where read_at is null and archived_at is null),'total',(select count(*) from filtered),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('key',key,'type',split_part(key,':',1),'title',title,'body',body,'href',href,'createdAt',created_at,'readAt',read_at,'archivedAt',archived_at,'updatedAt',updated_at)) from page),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function private.workspace_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_impl(text,jsonb) to authenticated;
-- SQL-language wrappers may bind an earlier function OID; explicitly bind the new implementation.
create or replace function public.workspace(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_impl(p_action,p_data) $$;
