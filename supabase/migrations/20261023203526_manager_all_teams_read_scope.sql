-- Visibility is independent of role and never widens the manager's write scope.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.perfis add column visualizar_todos_gestores boolean not null default false;
alter table public.perfis add constraint perfis_all_managers_only_for_manager
 check (not visualizar_todos_gestores or papel_usuario is not distinct from 'GESTOR'::public.papel_usuario);
grant select (visualizar_todos_gestores) on public.perfis to authenticated;

-- Legacy role changes must also clear this capability. Direct profile writes remain revoked.
create function private.clear_manager_visibility() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.papel_usuario is distinct from 'GESTOR'::public.papel_usuario then new.visualizar_todos_gestores:=false;end if;
 return new;
end $$;
revoke all on function private.clear_manager_visibility() from public,anon,authenticated,service_role;
create trigger perfis_clear_manager_visibility before insert or update on public.perfis
for each row execute function private.clear_manager_visibility();

create function private.manager_can_view_all() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.perfis p where p.id=(select auth.uid())
  and p.status_usuario='APROVADO' and p.papel_usuario='GESTOR' and p.visualizar_todos_gestores)
$$;
revoke all on function private.manager_can_view_all() from public,anon,authenticated,service_role;

-- Every monitoring reader (including detail, photos, exports and dashboards) uses this gate.
create or replace function private.monitoring_can_read(p_employee uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.perfis p join public.colaboradores c on c.id=p_employee
  where p.id=(select auth.uid()) and p.status_usuario='APROVADO'
  and (p.papel_usuario in ('ADMIN','RH','LEITURA') or (p.papel_usuario='GESTOR'
   and (p.visualizar_todos_gestores or (p.gestor_id is not null and c.gestor_id=p.gestor_id)))))
$$;

-- Preserve existing validation, locks, concurrency and audit in the administrative editor.
do $migration$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('private.administration_users_impl(text,jsonb)'::regprocedure);
 needle:='jsonb_build_object(''updated_at'',p.updated_at)';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_USER_LIST_CHANGED';end if;
 definition:=replace(definition,needle,'jsonb_build_object(''updated_at'',p.updated_at,''visualizar_todos_gestores'',p.visualizar_todos_gestores)');
 needle:='new_role:=(p_data->>''role'')::public.papel_usuario;';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_USER_VALIDATION_CHANGED';end if;
 definition:=replace(definition,needle, $validation$
 if p_data ? 'viewAllManagers' and jsonb_typeof(p_data->'viewAllManagers') is distinct from 'boolean' then raise exception 'USER_EDIT_INVALID';end if;
 if p_data->>'role' is distinct from 'GESTOR' and p_data->>'viewAllManagers'='true' then raise exception 'USER_EDIT_INVALID';end if;
 $validation$||needle);
 needle:='gestor_id=manager where id=target.id returning * into changed';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_USER_SAVE_CHANGED';end if;
 definition:=replace(definition,needle,'gestor_id=manager,visualizar_todos_gestores=case when new_role=''GESTOR'' then coalesce((p_data->>''viewAllManagers'')::boolean,target.visualizar_todos_gestores) else false end where id=target.id returning * into changed');
 needle:='''managerId'',target.gestor_id,';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_USER_BEFORE_CHANGED';end if;
 definition:=replace(definition,needle,needle||'''viewAllManagers'',target.visualizar_todos_gestores,');
 needle:='''managerId'',changed.gestor_id,';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_USER_AFTER_CHANGED';end if;
 definition:=replace(definition,needle,needle||'''viewAllManagers'',changed.visualizar_todos_gestores,');
 execute definition;
end $migration$;

-- Expand only read predicates; role and manager identity are never substituted.
do $migration$
declare signature text; definition text; needle text;
begin
 foreach signature in array array[
  'private.ler_quadro_atual_impl()',
  'chamada_privada.ler_banco_horas_atual_impl(date)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:='v_role <> ''GESTOR'' or (v_manager is not null and c.gestor_id = v_manager)';
  if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_READ_CHANGED: %',signature;end if;
  execute replace(definition,needle,'v_role <> ''GESTOR'' or (select private.manager_can_view_all()) or (v_manager is not null and c.gestor_id = v_manager)');
 end loop;
 definition:=pg_get_functiondef('private.daily_call_read_impl(date,date,date,text)'::regprocedure);
 needle:='profile.papel_usuario<>''GESTOR'' or (profile.gestor_id is not null and c.gestor_id=profile.gestor_id)';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_DAILY_READ_CHANGED';end if;
 definition:=replace(definition,needle,'profile.papel_usuario<>''GESTOR'' or profile.visualizar_todos_gestores or (profile.gestor_id is not null and c.gestor_id=profile.gestor_id)');
 needle:='''manager'',g.nome,''admissionDate'',c.admissao';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_DAILY_ROW_CHANGED';end if;
 definition:=replace(definition,needle,needle||',''canWrite'',coalesce((profile.papel_usuario in (''ADMIN'',''RH'') or (profile.papel_usuario=''GESTOR'' and profile.gestor_id is not null and c.gestor_id=profile.gestor_id)),false)');
 execute definition;
 foreach signature in array array[
  'private.daily_call_rows(date,date,uuid,boolean,public.papel_usuario,uuid)',
  'private.daily_call_cached_rows(date,date,uuid,boolean,public.papel_usuario,uuid)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:='p_role<>''GESTOR'' or (p_actor_manager is not null and c.gestor_id=p_actor_manager)';
  if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_QUEUE_CHANGED: %',signature;end if;
  execute replace(definition,needle,'p_role<>''GESTOR'' or (select private.manager_can_view_all()) or (p_actor_manager is not null and c.gestor_id=p_actor_manager)');
 end loop;
end $migration$;

-- Schedules and private attachments become readable across teams, never writable.
do $migration$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('private.employee_schedule_impl(text,jsonb)'::regprocedure);
 needle:='if employee.id is null or (profile.papel_usuario=''GESTOR'' and (profile.gestor_id is null or employee.gestor_id is distinct from profile.gestor_id)) then';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_SCHEDULE_SCOPE_CHANGED';end if;
 definition:=replace(definition,needle,'if employee.id is null or (profile.papel_usuario=''GESTOR'' and not profile.visualizar_todos_gestores and (profile.gestor_id is null or employee.gestor_id is distinct from profile.gestor_id)) then');
 needle:='can_edit:=profile.papel_usuario in (''ADMIN'',''RH'',''GESTOR'');';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_SCHEDULE_WRITE_CHANGED';end if;
 definition:=replace(definition,needle,'can_edit:=coalesce(profile.papel_usuario in (''ADMIN'',''RH'') or (profile.papel_usuario=''GESTOR'' and profile.gestor_id is not null and employee.gestor_id=profile.gestor_id),false);');
 execute definition;
 definition:=pg_get_functiondef('private.daily_call_attachment_internal(text,jsonb,uuid,boolean)'::regprocedure);
 needle:='(profile.papel_usuario=''GESTOR'' and (profile.gestor_id is null or c.gestor_id is distinct from profile.gestor_id))';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_ATTACHMENT_SCOPE_CHANGED';end if;
 execute replace(definition,needle,'(profile.papel_usuario=''GESTOR'' and not (p_action in (''list'',''download'') and profile.visualizar_todos_gestores) and (profile.gestor_id is null or c.gestor_id is distinct from profile.gestor_id))');
end $migration$;

-- Vacation and calendar listing follows visibility; existing proposal/write checks stay scoped.
do $migration$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('private.administration_impl(text,text,jsonb)'::regprocedure);
 needle:='v_role<>''GESTOR'' or (v_manager is not null and r->>''managerId''=v_manager::text)';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_VACATION_READ_CHANGED';end if;
 definition:=replace(definition,needle,'v_role<>''GESTOR'' or (select private.manager_can_view_all()) or (v_manager is not null and r->>''managerId''=v_manager::text)');
 needle:='from public.gestores where v_role<>''GESTOR'' or id=v_manager';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_VACATION_MANAGERS_CHANGED';end if;
 definition:=replace(definition,needle,'from public.gestores where v_role<>''GESTOR'' or (select private.manager_can_view_all()) or id=v_manager');
 needle:='from public.colaboradores where v_role<>''GESTOR'' or (v_manager is not null and gestor_id=v_manager)';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_VACATION_EMPLOYEES_CHANGED';end if;
 definition:=replace(definition,needle,'from public.colaboradores where v_role<>''GESTOR'' or (select private.manager_can_view_all()) or (v_manager is not null and gestor_id=v_manager)');
 needle:='''activeInSystem'',ativo_no_sistema)';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_VACATION_PROPOSALS_CHANGED';end if;
 definition:=replace(definition,needle,'''canPropose'',coalesce(v_role in (''ADMIN'',''RH'') or (v_role=''GESTOR'' and v_manager is not null and gestor_id=v_manager),false),'||needle);
 execute definition;
 definition:=pg_get_functiondef('private.schedule_planning_impl(text,jsonb)'::regprocedure);
 needle:='where role_name<>''GESTOR'' or scope=''global''';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_PLANNING_READ_CHANGED';end if;
 definition:=replace(definition,needle,'where role_name<>''GESTOR'' or (select private.manager_can_view_all()) or scope=''global''');
 needle:='role_name<>''GESTOR'' or id=manager';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_PLANNING_MANAGERS_CHANGED';end if;
 definition:=replace(definition,needle,'role_name<>''GESTOR'' or (select private.manager_can_view_all()) or id=manager');
 needle:='from public.colaboradores where role_name<>''GESTOR'' or gestor_id=manager';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_PLANNING_EMPLOYEES_CHANGED';end if;
 definition:=replace(definition,needle,'from public.colaboradores where role_name<>''GESTOR'' or (select private.manager_can_view_all()) or gestor_id=manager');
 needle:='''active'',ativo_no_sistema,''admissionDate'',admissao';
 if strpos(definition,needle)=0 then raise exception 'MANAGER_VISIBILITY_PLANNING_PROPOSALS_CHANGED';end if;
 definition:=replace(definition,needle,'''canPropose'',coalesce(role_name in (''ADMIN'',''RH'') or (role_name=''GESTOR'' and manager is not null and gestor_id=manager),false),'||needle);
 execute definition;
end $migration$;

comment on column public.perfis.visualizar_todos_gestores is
 'GESTOR can read all teams. Does not grant ADMIN/RH privileges or cross-team writes. Managed through audited administrative user edits.';
