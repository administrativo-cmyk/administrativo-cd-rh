-- Administrative edits use the same lock and last-ADMIN invariant as access blocking.
create table private.user_edit_audit (
 id bigint generated always as identity primary key, user_id uuid not null references public.perfis on delete restrict,
 actor uuid not null references public.perfis on delete restrict, reason text not null check(length(reason) between 5 and 1000),
 before_record jsonb not null, after_record jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table private.user_edit_audit enable row level security;
create index user_edit_audit_user on private.user_edit_audit(user_id,created_at desc);
create index user_edit_audit_actor on private.user_edit_audit(actor);
revoke all on private.user_edit_audit from public,anon,authenticated,service_role;
-- Changing away from GESTOR explicitly removes the team link and retains that removal in history.
alter table private.perfis_gestor_auditoria alter column gestor_novo_id drop not null;

create function private.administration_users_impl(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); actor_role public.papel_usuario; target public.perfis; changed public.perfis;
 new_role public.papel_usuario; manager uuid; result jsonb; old_value jsonb; new_value jsonb;
begin
 if p_action='save' then
  perform pg_advisory_xact_lock(824202609,1);
  perform pg_advisory_xact_lock(791800,1);
 end if;
 select papel_usuario into actor_role from public.perfis where id=actor and status_usuario='APROVADO';
 if actor_role is null or actor_role not in ('ADMIN','RH') then raise exception 'USER_EDIT_FORBIDDEN'; end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(u)||jsonb_build_object('updated_at',p.updated_at)),'[]') into result
  from private.listar_usuarios_impl(nullif(p_data->>'status','')::public.status_usuario,nullif(p_data->>'role','')::public.papel_usuario,p_data->>'search') u
  join public.perfis p on p.id=u.id;
  return result;
 elsif p_action is null or p_action<>'save' then raise exception 'USER_EDIT_INVALID'; end if;
 if length(btrim(coalesce(p_data->>'name',''))) not between 2 and 200 or length(btrim(coalesce(p_data->>'reason',''))) not between 5 and 1000
  or nullif(p_data->>'expectedUpdatedAt','') is null then raise exception 'USER_EDIT_INVALID'; end if;
 select * into target from public.perfis where id=(p_data->>'id')::uuid for update;
 if not found then raise exception 'USER_EDIT_NOT_FOUND'; end if;
 if actor_role='RH' and (target.papel_usuario is null or target.papel_usuario not in ('GESTOR','LEITURA')) then raise exception 'USER_EDIT_FORBIDDEN'; end if;
 if target.status_usuario='PENDENTE' then raise exception 'USER_EDIT_PENDING'; end if;
 if target.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz then raise exception 'USER_EDIT_STALE'; end if;
 new_role:=(p_data->>'role')::public.papel_usuario; manager:=(p_data->>'managerId')::uuid;
 if new_role is null or (actor_role='RH' and new_role not in ('GESTOR','LEITURA')) then raise exception 'USER_EDIT_FORBIDDEN'; end if;
 if (new_role='GESTOR' and (manager is null or not exists(select 1 from public.gestores where id=manager and ativo)))
  or (new_role<>'GESTOR' and manager is not null) then raise exception 'USER_EDIT_MANAGER_REQUIRED'; end if;
 if target.status_usuario='APROVADO' and target.papel_usuario='ADMIN' and new_role<>'ADMIN' then
  if (select count(*) from public.perfis where status_usuario='APROVADO' and papel_usuario='ADMIN')<=1 then raise exception 'USER_EDIT_LAST_ADMIN'; end if;
 end if;
 old_value:=jsonb_build_object('name',target.nome_completo,'role',target.papel_usuario,'managerId',target.gestor_id,'updatedAt',target.updated_at);
 update public.perfis set nome_completo=btrim(p_data->>'name'),papel_usuario=new_role,gestor_id=manager where id=target.id returning * into changed;
 new_value:=jsonb_build_object('name',changed.nome_completo,'role',changed.papel_usuario,'managerId',changed.gestor_id,'updatedAt',changed.updated_at);
 insert into private.user_edit_audit(user_id,actor,reason,before_record,after_record) values(target.id,actor,btrim(p_data->>'reason'),old_value,new_value);
 if target.gestor_id is distinct from manager then
  insert into private.perfis_gestor_auditoria(usuario_id,gestor_anterior_id,gestor_novo_id,alterado_por) values(target.id,target.gestor_id,manager,actor);
 end if;
 return jsonb_build_object('id',target.id,'updatedAt',changed.updated_at);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'USER_EDIT_INVALID';
end $$;
revoke all on function private.administration_users_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.administration_users_impl(text,jsonb) to authenticated;
create function public.administration_users(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.administration_users_impl(p_action,p_data)$$;
revoke all on function public.administration_users(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.administration_users(text,jsonb) to authenticated;

-- Legacy approval/reactivation/linking must take the invariant lock before target row locks.
do $$ declare signature text; definition text; begin
 foreach signature in array array['private.aprovar_usuario_impl(uuid,public.papel_usuario,uuid)','private.reativar_usuario_impl(uuid)','private.vincular_gestor_usuario_impl(uuid,uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=regexp_replace(definition,E'begin\\s*',E'begin\n  perform pg_catalog.pg_advisory_xact_lock(824202609,1);\n  perform pg_catalog.pg_advisory_xact_lock(791800,1);\n','i');
  execute definition;
 end loop;
end $$;

alter table public.monitoring_settings add column updated_at timestamptz not null default clock_timestamp(),
 add column revision integer not null default 1 check(revision>0),
 add column supersedes_id uuid unique references public.monitoring_settings(id) on delete restrict;
create trigger zz_monitoring_setting_touch before update on public.monitoring_settings for each row execute function private.administration_touch();

-- Direct authenticated RPC calls receive the same structural validation as the HTTP form.
create function private.monitoring_validate_setting(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare p jsonb:=p_data->'payload'; kind text:=p_data->>'kind'; value jsonb; key text; duration numeric; from_date date; to_date date;
 iso_instant text:='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$';
begin
 from_date:=(p_data->>'validFrom')::date; to_date:=(p_data->>'validTo')::date;
 if kind is null or kind not in ('mapping','schedule','policy','coverage','rule','user_link','group_snapshot','evidence','manual_event')
  or jsonb_typeof(p) is distinct from 'object' or length(btrim(coalesce(p_data->>'target',''))) not between 1 and 200
  or length(btrim(coalesce(p_data->>'reason',''))) not between 5 and 1000 or from_date is null or not isfinite(from_date)
  or coalesce(p_data->>'validFrom','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or (to_date is not null and (not isfinite(to_date) or to_date<from_date or p_data->>'validTo'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) then raise exception 'SETTING_INVALID_INPUT'; end if;
 if kind in ('schedule','user_link','group_snapshot','evidence','manual_event') or (kind='policy' and p->>'scope'='person') then
  if not exists(select 1 from public.colaboradores where id=(p_data->>'target')::uuid and ativo_no_sistema) then raise exception 'SETTING_INVALID_INPUT'; end if;
 end if;
 if kind='mapping' then
  if p->>'pointId' is distinct from p_data->>'target' or length(btrim(coalesce(p->>'portalId',''))) not between 1 and 200
   or coalesce(p->>'area','') not in ('operation','cafeteria','perimeter') or coalesce(p->>'direction','') not in ('entry','exit')
   or jsonb_typeof(p->'validated') is distinct from 'boolean' or jsonb_typeof(p->'eventClasses') is distinct from 'array' then raise exception 'SETTING_INVALID_INPUT'; end if;
  if jsonb_array_length(p->'eventClasses')<1 then raise exception 'SETTING_INVALID_INPUT'; end if;
  for value in select * from jsonb_array_elements(p->'eventClasses') loop
   if jsonb_typeof(value)<>'string' or length(btrim(value#>>'{}')) not between 1 and 200 then raise exception 'SETTING_INVALID_INPUT'; end if;
  end loop;
  if p ? 'effects' then
   if jsonb_typeof(p->'effects')<>'object' then raise exception 'SETTING_INVALID_INPUT'; end if;
   for key,value in select * from jsonb_each(p->'effects') loop
    if key not in ('operation','cafeteria','perimeter') or coalesce(value#>>'{}','') not in ('inside','outside') then raise exception 'SETTING_INVALID_INPUT'; end if;
   end loop;
   if (p#>>array['effects',p->>'area']) is not null and (p#>>array['effects',p->>'area'])<>(case p->>'direction' when 'entry' then 'inside' else 'outside' end) then raise exception 'SETTING_INVALID_INPUT'; end if;
  end if;
 elsif kind='schedule' then
  if length(btrim(coalesce(p->>'name',''))) not between 1 and 200 or coalesce(p->>'start','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p->>'end','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or jsonb_typeof(p->'days') is distinct from 'array' or jsonb_typeof(p->'allowNoBreak') is distinct from 'boolean' or coalesce(p->>'pairing','') not in ('explicit','alternating') then raise exception 'SETTING_INVALID_INPUT'; end if;
  if jsonb_array_length(p->'days') not between 1 and 7 then raise exception 'SETTING_INVALID_INPUT'; end if;
  for value in select * from jsonb_array_elements(p->'days') loop if value::text!~'^[0-6]$' then raise exception 'SETTING_INVALID_INPUT'; end if; end loop;
  if p ? 'coffeeWindows' then
   if jsonb_typeof(p->'coffeeWindows')<>'array' then raise exception 'SETTING_INVALID_INPUT'; end if;
   if jsonb_array_length(p->'coffeeWindows')>5 then raise exception 'SETTING_INVALID_INPUT'; end if;
   for value in select * from jsonb_array_elements(p->'coffeeWindows') loop
    if coalesce(value->>'start','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(value->>'end','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'SETTING_INVALID_INPUT'; end if;
   end loop;
  end if;
 elsif kind='policy' then
  if coalesce(p->>'indicator','') not in ('outsideOperation','cafeteria','outsideCd','lateness') or coalesce(p->>'scope','') not in ('group','person') or jsonb_typeof(p->'exclude') is distinct from 'boolean' then raise exception 'SETTING_INVALID_INPUT'; end if;
 elsif kind='coverage' then
  if coalesce(p->>'area','') not in ('operation','cafeteria','perimeter') or jsonb_typeof(p->'declaredComplete') is distinct from 'boolean'
   or length(btrim(coalesce(p->>'evidence',''))) not between 5 and 1000 or jsonb_typeof(p->'sourceIds') is distinct from 'array'
   or coalesce(p->>'start','')!~iso_instant or coalesce(p->>'end','')!~iso_instant or not isfinite((p->>'start')::timestamptz) or not isfinite((p->>'end')::timestamptz) or (p->>'end')::timestamptz<=(p->>'start')::timestamptz then raise exception 'SETTING_INVALID_INPUT'; end if;
  if jsonb_array_length(p->'sourceIds')<1 then raise exception 'SETTING_INVALID_INPUT'; end if;
  for value in select * from jsonb_array_elements(p->'sourceIds') loop
   if jsonb_typeof(value)<>'string' or length(btrim(value#>>'{}')) not between 1 and 200 then raise exception 'SETTING_INVALID_INPUT'; end if;
  end loop;
 elsif kind='rule' then
  if p_data->>'target'<>'global' then raise exception 'SETTING_INVALID_INPUT'; end if;
  foreach key in array array['punchRepeatSeconds','accessRepeatSeconds','initialLookbackSeconds','maxJourneyHours'] loop
   if jsonb_typeof(p->key) is distinct from 'number' then raise exception 'SETTING_INVALID_INPUT'; end if;
   duration:=(p->>key)::numeric;
   if duration<(case when key='maxJourneyHours' then 1 else 0 end) or duration>(case key when 'punchRepeatSeconds' then 120 when 'accessRepeatSeconds' then 60 when 'initialLookbackSeconds' then 86400 else 36 end)
    or trunc(duration*(case when key='maxJourneyHours' then 3600000 else 1000 end))<>duration*(case when key='maxJourneyHours' then 3600000 else 1000 end) then raise exception 'SETTING_INVALID_INPUT'; end if;
  end loop;
  if p ? 'suppressUntypedPunches' and jsonb_typeof(p->'suppressUntypedPunches')<>'boolean' then raise exception 'SETTING_INVALID_INPUT'; end if;
 elsif kind='user_link' then
  if not exists(select 1 from public.perfis where id=(p->>'userId')::uuid and status_usuario='APROVADO') then raise exception 'SETTING_INVALID_INPUT'; end if;
 elsif kind='group_snapshot' then
  if jsonb_typeof(p->'groups') is distinct from 'array' or length(btrim(coalesce(p->>'evidence',''))) not between 5 and 1000 then raise exception 'SETTING_INVALID_INPUT'; end if;
  if jsonb_array_length(p->'groups')>50 then raise exception 'SETTING_INVALID_INPUT'; end if;
  for value in select * from jsonb_array_elements(p->'groups') loop if jsonb_typeof(value)<>'string' or length(btrim(value#>>'{}')) not between 1 and 200 then raise exception 'SETTING_INVALID_INPUT'; end if; end loop;
 elsif kind='evidence' then
  foreach key in array array['startConfirmed','endConfirmed','startCoverageConfirmed'] loop if jsonb_typeof(p->key) is distinct from 'boolean' then raise exception 'SETTING_INVALID_INPUT'; end if; end loop;
  if p ? 'ongoingConfirmed' and jsonb_typeof(p->'ongoingConfirmed')<>'boolean' then raise exception 'SETTING_INVALID_INPUT'; end if;
  if p ? 'punchCoverageUntil' and (coalesce(p->>'punchCoverageUntil','')!~iso_instant or not isfinite((p->>'punchCoverageUntil')::timestamptz)) then raise exception 'SETTING_INVALID_INPUT'; end if;
  if p ? 'punchRoles' then
   if jsonb_typeof(p->'punchRoles')<>'object' then raise exception 'SETTING_INVALID_INPUT'; end if;
   for key,value in select * from jsonb_each(p->'punchRoles') loop if coalesce(value#>>'{}','') not in ('start','breakStart','breakEnd','end') then raise exception 'SETTING_INVALID_INPUT'; end if; end loop;
  end if;
 elsif kind='manual_event' then
  if coalesce(p->>'at','')!~iso_instant or not isfinite((p->>'at')::timestamptz) or length(btrim(coalesce(p->>'justification',''))) not between 5 and 1000 then raise exception 'SETTING_INVALID_INPUT'; end if;
  foreach key in array array['pointId','sourceId','eventClass'] loop if length(btrim(coalesce(p->>key,''))) not between 1 and 200 then raise exception 'SETTING_INVALID_INPUT'; end if; end loop;
 end if;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'SETTING_INVALID_INPUT';
end $$;
revoke all on function private.monitoring_validate_setting(jsonb) from public,anon,authenticated,service_role;

create function private.monitoring_prepare_setting_change(p_employee uuid,p_start date,p_end date) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.monitoring_enqueue(p_employee,p_start,p_end,null);
 insert into public.monitoring_jobs(employee_id,operational_date,reason)
 select employee_id,operational_date,'Configuração revisada' from public.monitoring_results
 where active and (p_employee is null or employee_id=p_employee) and operational_date between p_start and coalesce(p_end,'9999-12-31') order by employee_id,operational_date
 on conflict(employee_id,operational_date) do update set reason=excluded.reason,leased_until=null,lease_token=null;
end $$;
revoke all on function private.monitoring_prepare_setting_change(uuid,date,date) from public,anon,authenticated,service_role;

create function private.monitoring_setting_change_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); old public.monitoring_settings; fresh jsonb; output jsonb; new_id uuid;
 employee uuid; start_date date; end_date date; expected timestamptz;
begin
 if not exists(select 1 from public.perfis where id=actor and status_usuario='APROVADO' and papel_usuario in ('ADMIN','RH')) then raise exception using errcode='42501',message='SETTING_FORBIDDEN'; end if;
 if p_action is null or p_action not in ('replace','restore','revoke') or length(btrim(coalesce(p_data->>'reason',''))) not between 5 and 1000 then raise exception 'SETTING_INVALID_INPUT'; end if;
 expected:=(p_data->>'expectedUpdatedAt')::timestamptz;
 if expected is null then raise exception 'SETTING_VERSION_REQUIRED'; end if;
 perform pg_advisory_xact_lock(791702);
 select * into old from public.monitoring_settings where id=(p_data->>'id')::uuid;
 if not found then raise exception 'SETTING_NOT_FOUND'; end if;
 if old.updated_at<>expected then raise exception 'SETTING_STALE'; end if;
 if exists(select 1 from public.monitoring_settings where supersedes_id=old.id) then raise exception 'SETTING_SUPERSEDED'; end if;
 if (p_action in ('replace','revoke') and old.revoked_at is not null) or (p_action='restore' and old.revoked_at is null) then raise exception 'SETTING_STALE'; end if;
 if p_action='replace' then
  fresh:=p_data->'setting';
  if fresh->>'kind' is distinct from old.kind or fresh->>'target' is distinct from old.target then raise exception 'SETTING_TARGET_IMMUTABLE'; end if;
  if old.kind='policy' and fresh#>>'{payload,scope}' is distinct from old.payload->>'scope' then raise exception 'SETTING_TARGET_IMMUTABLE'; end if;
 else fresh:=jsonb_build_object('kind',old.kind,'target',old.target,'validFrom',old.valid_from,'validTo',old.valid_to,'payload',old.payload); end if;
 fresh:=fresh||jsonb_build_object('reason',btrim(p_data->>'reason'));
 if p_action<>'revoke' then perform private.monitoring_validate_setting(fresh); end if;
 start_date:=least(old.valid_from,(fresh->>'validFrom')::date);
 end_date:=case when old.valid_to is null or fresh->>'validTo' is null then null else greatest(old.valid_to,(fresh->>'validTo')::date) end;
 if old.kind in ('schedule','group_snapshot','evidence','manual_event','user_link') or (old.kind='policy' and old.payload->>'scope'='person') then employee:=old.target::uuid; end if;
 -- Workers finish under job then revision locks. Prequeue the entire old/new period first.
 perform private.monitoring_prepare_setting_change(employee,start_date,end_date);
 perform 1 from private.monitoring_revision where id=true for update;
 select * into old from public.monitoring_settings where id=old.id for update;
 if old.updated_at<>expected then raise exception 'SETTING_STALE'; end if;
 if p_action<>'restore' then update public.monitoring_settings set revoked_at=clock_timestamp() where id=old.id; end if;
 if p_action='revoke' then
  update private.monitoring_revision set version=version+1 where id=true;
  output:=jsonb_build_object('ok',true,'id',old.id);
 else
  output:=private.monitoring_query_impl('setting',fresh); new_id:=(output->>'id')::uuid;
  update public.monitoring_settings set revision=old.revision+1,supersedes_id=old.id where id=new_id;
 end if;
 update public.monitoring_results set dirty=true where active and (employee is null or employee_id=employee) and operational_date between start_date and coalesce(end_date,'9999-12-31');
 insert into public.monitoring_audit(actor,action,target,detail) values(actor,p_action||'_setting',coalesce(new_id,old.id)::text,jsonb_build_object('reason',p_data->>'reason','previousId',old.id,'revision',case when new_id is null then old.revision else old.revision+1 end));
 return output;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'SETTING_INVALID_INPUT';
end $$;
revoke all on function private.monitoring_setting_change_impl(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_setting_change_impl(text,jsonb) to authenticated;
create function public.monitoring_setting_change(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.monitoring_setting_change_impl(p_action,p_data)$$;
revoke all on function public.monitoring_setting_change(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.monitoring_setting_change(text,jsonb) to authenticated;

-- Old clients cannot revoke a setting without the version displayed to the administrator.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('private.monitoring_query_impl(text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,'elsif p_action=''setting'' then','')))/length('elsif p_action=''setting'' then')<>1
  or (length(definition)-length(replace(definition,'elsif p_action=''revoke_setting'' then','')))/length('elsif p_action=''revoke_setting'' then')<>1 then raise exception 'MONITORING_SETTING_DEFINITION_CHANGED'; end if;
 definition:=replace(definition,'elsif p_action=''setting'' then',
  'elsif p_action=''setting'' then
    perform private.monitoring_validate_setting(p_data);
    perform pg_advisory_xact_lock(791702);
    employee:=case when p_data->>''kind'' in (''schedule'',''group_snapshot'',''evidence'',''manual_event'',''user_link'') or (p_data->>''kind''=''policy'' and p_data#>>''{payload,scope}''=''person'') then (p_data->>''target'')::uuid else null end;
    perform private.monitoring_prepare_setting_change(employee,(p_data->>''validFrom'')::date,(p_data->>''validTo'')::date);
    perform 1 from private.monitoring_revision where id=true for update;');
 definition:=replace(definition,'elsif p_action=''revoke_setting'' then','elsif p_action=''revoke_setting'' then raise exception ''SETTING_VERSION_REQUIRED'';');
 execute definition;
end $$;
