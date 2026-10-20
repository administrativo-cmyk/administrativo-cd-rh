-- Personal view preferences use their own row, so changing Chamada cannot overwrite
-- dashboard/density/notification settings. Only the authenticated owner can read/write.
create table private.workspace_daily_call_preferences (
 user_id uuid primary key references public.perfis(id) on delete restrict,
 view_mode text not null default 'today' check (view_mode in ('today','period')),
 columns_collapsed boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);
alter table private.workspace_daily_call_preferences enable row level security;
revoke all on private.workspace_daily_call_preferences from public,anon,authenticated,service_role;
create trigger workspace_daily_call_preferences_touch before update on private.workspace_daily_call_preferences
 for each row execute function private.administration_touch();

alter function private.workspace_impl(text,jsonb) rename to workspace_before_daily_call_preferences;
revoke all on function private.workspace_before_daily_call_preferences(text,jsonb) from public,anon,authenticated,service_role;
create function private.workspace_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid()); v_profile public.perfis;
 v_preferences private.workspace_daily_call_preferences; v_before jsonb;
begin
 if p_action not in ('daily_call_preferences','save_daily_call_preferences') then
  return private.workspace_before_daily_call_preferences(p_action,p_data);
 end if;
 select * into v_profile from public.perfis where id=v_actor and status_usuario='APROVADO' for update;
 if v_actor is null or v_profile.id is null then raise exception using errcode='42501',message='WORKSPACE_FORBIDDEN'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
 -- This is an identity guard, never a selectable write target. It blocks an old
 -- browser request when the authenticated account changed in another tab.
 if (p_data->>'expectedUserId')::uuid is distinct from v_actor then
  raise exception using errcode='42501',message='WORKSPACE_FORBIDDEN';
 end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('expectedUserId','expectedUpdatedAt','viewMode','columnsCollapsed'))
  or (p_action='daily_call_preferences' and (p_data ? 'viewMode' or p_data ? 'columnsCollapsed' or p_data ? 'expectedUpdatedAt'))
 then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
 select * into v_preferences from private.workspace_daily_call_preferences where user_id=v_actor;
 if p_action='save_daily_call_preferences' then
  if not (p_data ? 'expectedUpdatedAt') or not (p_data ? 'viewMode' or p_data ? 'columnsCollapsed')
   or (p_data ? 'viewMode' and (jsonb_typeof(p_data->'viewMode') is distinct from 'string' or p_data->>'viewMode' not in ('today','period')))
   or (p_data ? 'columnsCollapsed' and jsonb_typeof(p_data->'columnsCollapsed') is distinct from 'boolean')
  then raise exception 'WORKSPACE_INVALID_INPUT'; end if;
  -- A keepalive request from the previous page must never replace a newer save.
  -- The profile lock above serializes both first insert and existing-row writes.
  if (p_data->>'expectedUpdatedAt')::timestamptz is distinct from v_preferences.updated_at then
   raise exception 'WORKSPACE_STALE';
  end if;
  v_before:=to_jsonb(v_preferences);
  insert into private.workspace_daily_call_preferences(user_id,view_mode,columns_collapsed)
   values(v_actor,coalesce(p_data->>'viewMode','today'),coalesce((p_data->>'columnsCollapsed')::boolean,false))
   on conflict(user_id) do update set
    view_mode=case when p_data ? 'viewMode' then excluded.view_mode else workspace_daily_call_preferences.view_mode end,
    columns_collapsed=case when p_data ? 'columnsCollapsed' then excluded.columns_collapsed else workspace_daily_call_preferences.columns_collapsed end
   returning * into v_preferences;
  insert into private.workspace_audit(actor,action,record_id,before_record,after_record)
   values(v_actor,p_action,v_actor,v_before,to_jsonb(v_preferences));
 end if;
 return jsonb_build_object('userId',v_actor,'viewMode',coalesce(v_preferences.view_mode,'today'),
  'columnsCollapsed',coalesce(v_preferences.columns_collapsed,false),'updatedAt',v_preferences.updated_at);
end $$;
revoke all on function private.workspace_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_impl(text,jsonb) to authenticated;
create or replace function public.workspace(p_action text,p_data jsonb default '{}') returns jsonb
 language sql security invoker set search_path='' as $$ select private.workspace_impl(p_action,p_data) $$;
revoke all on function public.workspace(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.workspace(text,jsonb) to authenticated;
