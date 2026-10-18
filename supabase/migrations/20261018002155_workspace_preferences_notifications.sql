-- Personal preferences and scoped notifications. No attendance or balance mutations.
create table private.workspace_preferences (
 user_id uuid primary key references public.perfis(id) on delete restrict,
 default_dashboard text not null default 'index' check(default_dashboard in ('index','monitoramento','chamada-diaria','banco-de-horas','quadro-atual')),
 compact_tables boolean not null default false, notifications_enabled boolean not null default true,
 updated_at timestamptz not null default clock_timestamp()
);
create table private.workspace_notices (
 id uuid primary key default gen_random_uuid(), title text not null check(length(btrim(title)) between 3 and 160),
 body text not null check(length(btrim(body)) between 3 and 4000), audience_role public.papel_usuario,
 manager_id uuid references public.gestores(id) on delete restrict,
 created_by uuid not null references public.perfis(id) on delete restrict,
 archived_at timestamptz, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check(audience_role is null or manager_id is null)
);
create table private.workspace_notification_state (
 user_id uuid not null references public.perfis(id) on delete restrict, notification_key text not null,
 read_at timestamptz, archived_at timestamptz, updated_at timestamptz not null default clock_timestamp(),
 primary key(user_id,notification_key)
);
create table private.workspace_audit (
 id bigint generated always as identity primary key, actor uuid not null references public.perfis(id),
 action text not null, record_id uuid not null, reason text, before_record jsonb, after_record jsonb,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.workspace_preferences enable row level security;
alter table private.workspace_notices enable row level security;
alter table private.workspace_notification_state enable row level security;
alter table private.workspace_audit enable row level security;
revoke all on private.workspace_preferences,private.workspace_notices,private.workspace_notification_state,private.workspace_audit from public,anon,authenticated,service_role;
create trigger workspace_preferences_touch before update on private.workspace_preferences for each row execute function private.administration_touch();
create trigger workspace_notices_touch before update on private.workspace_notices for each row execute function private.administration_touch();
create trigger workspace_state_touch before update on private.workspace_notification_state for each row execute function private.administration_touch();
create trigger zz_workspace_profile_touch before update on public.perfis for each row execute function private.administration_touch();
create index workspace_notices_active on private.workspace_notices(created_at desc) where archived_at is null;
create index workspace_notices_creator on private.workspace_notices(created_by);
create index workspace_notices_manager on private.workspace_notices(manager_id) where manager_id is not null;
create index workspace_audit_actor on private.workspace_audit(actor);

-- A changed proposal or notice has a new key: reading an earlier version never hides an update.
create function private.workspace_notifications(p_actor uuid,p_role public.papel_usuario,p_manager uuid)
returns table(key text,title text,body text,href text,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select 'notice:'||n.id::text||':'||n.updated_at::text,n.title,n.body,'/notificacoes',n.updated_at
 from private.workspace_notices n where n.archived_at is null
 and (n.audience_role is null or n.audience_role=p_role) and (n.manager_id is null or (p_role='GESTOR' and n.manager_id=p_manager))
 union all
 select 'vacation:'||f.id::text||':'||f.updated_at::text,
 case f.status when 'requested' then 'Férias aguardam análise' when 'approved' then 'Férias aprovadas' else 'Planejamento de férias cancelado' end,
 c.nome||' — '||to_char(f.inicio,'DD/MM/YYYY')||' a '||to_char(f.fim,'DD/MM/YYYY'),'/planejamento/ferias',f.updated_at
 from public.ferias_planejamento f join public.colaboradores c on c.id=f.colaborador_id
 where f.archived_at is null and ((f.status='requested' and p_role in ('ADMIN','RH'))
 or (f.status in ('approved','cancelled') and f.created_by=p_actor and (p_role<>'GESTOR' or c.gestor_id=p_manager)))
$$;
revoke all on function private.workspace_notifications(uuid,public.papel_usuario,uuid) from public,anon,authenticated,service_role;

create function private.workspace_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid()); v_profile public.perfis; v_preferences private.workspace_preferences;
 v_role public.papel_usuario; v_id uuid; v_old private.workspace_notices; v_new private.workspace_notices;
 v_before jsonb; v_result jsonb; v_expected timestamptz; v_title text; v_body text; v_reason text; v_audience public.papel_usuario; v_manager uuid;
 v_key text; v_offset integer:=coalesce((p_data->>'offset')::integer,0); v_limit integer:=coalesce((p_data->>'limit')::integer,25);
 v_include boolean:=coalesce((p_data->>'includeArchived')::boolean,false);
begin
 select * into v_profile from public.perfis where id=v_actor and status_usuario='APROVADO' for update;
 v_role:=v_profile.papel_usuario;
 if v_actor is null or v_role is null then raise exception using errcode='42501',message='WORKSPACE_FORBIDDEN'; end if;
 if p_action is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
 if v_offset<0 or v_offset>100000 or v_limit<1 or v_limit>100 then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
 if p_action in ('settings','save_preferences','reset_preferences') then
  select * into v_preferences from private.workspace_preferences where user_id=v_actor;
  if p_action<>'settings' then
   v_expected:=(p_data->>'expectedUpdatedAt')::timestamptz;
   if v_expected is distinct from v_preferences.updated_at then raise exception 'WORKSPACE_STALE'; end if;
   v_before:=to_jsonb(v_preferences);
   if p_action='reset_preferences' then
    -- Keep a version after reset: an older client that saw no row cannot overwrite it.
    insert into private.workspace_preferences(user_id,default_dashboard,compact_tables,notifications_enabled)
     values(v_actor,'index',false,true)
     on conflict(user_id) do update set default_dashboard='index',compact_tables=false,notifications_enabled=true;
   else
    if p_data->>'defaultDashboard' is null or p_data->>'defaultDashboard' not in ('index','monitoramento','chamada-diaria','banco-de-horas','quadro-atual')
      or jsonb_typeof(p_data->'compactTables') is distinct from 'boolean' or jsonb_typeof(p_data->'notificationsEnabled') is distinct from 'boolean' then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
    insert into private.workspace_preferences(user_id,default_dashboard,compact_tables,notifications_enabled)
     values(v_actor,p_data->>'defaultDashboard',(p_data->>'compactTables')::boolean,(p_data->>'notificationsEnabled')::boolean)
     on conflict(user_id) do update set default_dashboard=excluded.default_dashboard,compact_tables=excluded.compact_tables,notifications_enabled=excluded.notifications_enabled;
   end if;
   select * into v_preferences from private.workspace_preferences where user_id=v_actor;
   insert into private.workspace_audit(actor,action,record_id,before_record,after_record) values(v_actor,p_action,v_actor,v_before,to_jsonb(v_preferences));
  end if;
  return jsonb_build_object('defaultDashboard',coalesce(v_preferences.default_dashboard,'index'),'compactTables',coalesce(v_preferences.compact_tables,false),'notificationsEnabled',coalesce(v_preferences.notifications_enabled,true),'updatedAt',v_preferences.updated_at,'profileName',v_profile.nome_completo,'profileUpdatedAt',v_profile.updated_at);
 elsif p_action='save_profile' then
  if length(btrim(p_data->>'name')) not between 3 and 200 or p_data->>'name' is null then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
  if (p_data->>'expectedUpdatedAt')::timestamptz is distinct from v_profile.updated_at then raise exception 'WORKSPACE_STALE'; end if;
  update public.perfis set nome_completo=btrim(p_data->>'name') where id=v_actor returning jsonb_build_object('profileName',nome_completo,'profileUpdatedAt',updated_at) into v_result;
  insert into private.workspace_audit(actor,action,record_id,before_record,after_record) values(v_actor,p_action,v_actor,jsonb_build_object('profileName',v_profile.nome_completo),v_result);
  return v_result;
 elsif p_action in ('notifications','notification_state','notification_summary') then
  if p_action='notification_state' then
   v_key:=p_data->>'key';
   if not exists(select 1 from private.workspace_notifications(v_actor,v_role,v_profile.gestor_id) n where n.key=v_key) then raise exception 'WORKSPACE_NOT_FOUND'; end if;
   if jsonb_typeof(p_data->'read') is distinct from 'boolean' or jsonb_typeof(p_data->'archived') is distinct from 'boolean' then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
   insert into private.workspace_notification_state(user_id,notification_key,read_at,archived_at) values(v_actor,v_key,case when (p_data->>'read')::boolean then clock_timestamp() end,case when (p_data->>'archived')::boolean then clock_timestamp() end)
    on conflict(user_id,notification_key) do update set read_at=excluded.read_at,archived_at=excluded.archived_at;
  end if;
  with available as (select n.*,s.read_at,s.archived_at from private.workspace_notifications(v_actor,v_role,v_profile.gestor_id) n left join private.workspace_notification_state s on s.user_id=v_actor and s.notification_key=n.key),
  filtered as (select * from available where v_include or archived_at is null),
  page as (select * from filtered order by created_at desc,key limit case when p_action='notification_summary' then 0 else v_limit end offset v_offset)
  select jsonb_build_object('unread',(select count(*) from available where read_at is null and archived_at is null),'total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(jsonb_build_object('key',key,'title',title,'body',body,'href',href,'createdAt',created_at,'readAt',read_at,'archivedAt',archived_at)) from page),'[]'::jsonb)) into v_result;
  return v_result;
 elsif p_action in ('notices','save_notice','archive_notice','restore_notice') then
  if v_role not in ('ADMIN','RH') then raise exception using errcode='42501',message='WORKSPACE_FORBIDDEN'; end if;
  if p_action='notices' then
   with eligible as (select * from private.workspace_notices where (v_include or archived_at is null) and (v_role='ADMIN' or audience_role is distinct from 'ADMIN')),
   page as (select * from eligible order by created_at desc,id limit v_limit offset v_offset)
   select jsonb_build_object('total',(select count(*) from eligible),'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'audienceRole',audience_role,'managerId',manager_id,'createdAt',created_at,'updatedAt',updated_at,'archivedAt',archived_at)) from page),'[]'::jsonb),'managers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',nome) order by nome),'[]'::jsonb) from public.gestores where ativo)) into v_result;
   return v_result;
  end if;
  v_id:=(p_data->>'id')::uuid; v_expected:=(p_data->>'expectedUpdatedAt')::timestamptz; v_reason:=btrim(p_data->>'reason');
  if v_reason is null or length(v_reason) not between 5 and 1000 then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
  if v_id is not null then
   select * into v_old from private.workspace_notices where id=v_id for update;
   if not found then raise exception 'WORKSPACE_NOT_FOUND'; end if;
   if v_role='RH' and v_old.audience_role='ADMIN' then raise exception using errcode='42501',message='WORKSPACE_FORBIDDEN'; end if;
   if v_expected is distinct from v_old.updated_at then raise exception 'WORKSPACE_STALE'; end if;
  elsif v_expected is not null or p_action<>'save_notice' then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
  if p_action='save_notice' then
   v_title:=btrim(p_data->>'title'); v_body:=btrim(p_data->>'body'); v_audience:=(p_data->>'audienceRole')::public.papel_usuario; v_manager:=(p_data->>'managerId')::uuid;
   if v_title is null or v_body is null or length(v_title) not between 3 and 160 or length(v_body) not between 3 and 4000 or (v_audience is not null and v_manager is not null) or v_old.archived_at is not null then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
   if v_role='RH' and v_audience='ADMIN' then raise exception using errcode='42501',message='WORKSPACE_FORBIDDEN'; end if;
   if v_manager is not null and not exists(select 1 from public.gestores where id=v_manager and ativo) then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
   if v_id is null then insert into private.workspace_notices(title,body,audience_role,manager_id,created_by) values(v_title,v_body,v_audience,v_manager,v_actor) returning * into v_new;
   else update private.workspace_notices set title=v_title,body=v_body,audience_role=v_audience,manager_id=v_manager where id=v_id returning * into v_new; end if;
  else
   update private.workspace_notices set archived_at=case when p_action='archive_notice' then clock_timestamp() else null end where id=v_id returning * into v_new;
  end if;
  insert into private.workspace_audit(actor,action,record_id,reason,before_record,after_record) values(v_actor,p_action,v_new.id,v_reason,to_jsonb(v_old),to_jsonb(v_new));
  return jsonb_build_object('id',v_new.id,'updatedAt',v_new.updated_at);
 end if;
 raise exception 'WORKSPACE_INVALID_INPUT';
end $$;
revoke all on function private.workspace_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_impl(text,jsonb) to authenticated;
create function public.workspace(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_impl(p_action,p_data) $$;
revoke all on function public.workspace(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.workspace(text,jsonb) to authenticated;
