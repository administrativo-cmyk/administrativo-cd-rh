-- Query filters share the employee scope; administrative catalogs stay ADMIN/RH-only.
alter function private.monitoring_query_impl(text,jsonb) rename to monitoring_query_before_scoped_groups;
create function private.monitoring_query_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); role_name public.papel_usuario; catalog jsonb;
begin
 if p_action is distinct from 'filter_groups' then
  return private.monitoring_query_before_scoped_groups(p_action,p_data);
 end if;
 select papel_usuario into role_name from public.perfis where id=actor and status_usuario='APROVADO';
 if actor is null or role_name is null then
  raise exception using errcode='42501',message='MONITORING_FORBIDDEN';
 end if;
 if role_name in ('ADMIN','RH') then return private.monitoring_query_before_scoped_groups('groups',p_data); end if;
 with allowed as materialized (
  select c.id from public.colaboradores c where private.monitoring_can_read(c.id)
 ), identities as materialized (
  select distinct s.identity_namespace,b.identity_value from public.monitoring_bindings b
   join public.monitoring_sources s on s.id=b.source_id
   join allowed a on a.id=b.employee_id
   where b.identity_type='defense' and b.revoked_at is null
 ), raw_groups(groups) as (
  select pe.groups from public.monitoring_people pe
   join public.monitoring_files f on f.id=pe.file_id and f.status='complete'
   join public.monitoring_sources s on s.id=pe.source_id
   join identities i on i.identity_namespace=s.identity_namespace and i.identity_value=pe.external_id
  union all
  select variant from private.monitoring_group_observations o
   join public.monitoring_files f on f.id=o.file_id and f.status='complete'
   join identities i on i.identity_namespace=o.namespace and i.identity_value=o.external_id
   cross join lateral jsonb_array_elements(o.variants) variant
  union all
  select case when jsonb_typeof(s.payload->'groups')='string' then jsonb_build_array(s.payload->>'groups')
    else coalesce(s.payload->'groups','[]'::jsonb) end
   from public.monitoring_settings s join allowed a on a.id::text=s.target
   where s.kind='group_snapshot' and s.revoked_at is null
 ), names as (
  select distinct name from raw_groups
   cross join lateral jsonb_array_elements_text(private.monitoring_normalize_defense_groups(groups)) g(name)
 )
 select coalesce(jsonb_agg(name order by name),'[]'::jsonb) into catalog from names;
 return jsonb_build_object('groups',catalog,'queriedAt',now());
end $$;
revoke all on function private.monitoring_query_before_scoped_groups(text,jsonb),private.monitoring_query_impl(text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.monitoring_query_impl(text,jsonb) to authenticated;
