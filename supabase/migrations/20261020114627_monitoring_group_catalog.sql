-- A read-only catalog is independent of the 100-person administration page.
-- Existing group observations retain groups from older completed exports.
alter function private.monitoring_query_impl(text,jsonb) rename to monitoring_query_before_group_catalog;

create function private.monitoring_query_impl(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); role_name public.papel_usuario; catalog jsonb;
begin
 if p_action is distinct from 'groups' then
  return private.monitoring_query_before_group_catalog(p_action,p_data);
 end if;
 select papel_usuario into role_name from public.perfis where id=actor and status_usuario='APROVADO';
 if actor is null or role_name is null or role_name not in ('ADMIN','RH') then
  raise exception using errcode='42501',message='MONITORING_ADMIN_REQUIRED';
 end if;
 with raw_groups(groups) as (
  select pe.groups from public.monitoring_people pe
   join public.monitoring_files f on f.id=pe.file_id and f.status='complete'
  union all
  select variant from private.monitoring_group_observations o
   join public.monitoring_files f on f.id=o.file_id and f.status='complete'
   cross join lateral jsonb_array_elements(o.variants) variant
  union all
  select case when jsonb_typeof(s.payload->'groups')='string' then jsonb_build_array(s.payload->>'groups')
    else coalesce(s.payload->'groups','[]'::jsonb) end
   from public.monitoring_settings s where s.kind='group_snapshot' and s.revoked_at is null
  union all
  select jsonb_build_array(s.target) from public.monitoring_settings s
   where s.kind='policy' and s.payload->>'scope'='group' and s.revoked_at is null
 ), names as (
  select distinct name from raw_groups
   cross join lateral jsonb_array_elements_text(private.monitoring_normalize_defense_groups(groups)) g(name)
 )
 select coalesce(jsonb_agg(name order by name),'[]'::jsonb) into catalog from names;
 return jsonb_build_object('groups',catalog,'queriedAt',now());
end $$;
revoke all on function private.monitoring_query_before_group_catalog(text,jsonb),private.monitoring_query_impl(text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.monitoring_query_impl(text,jsonb) to authenticated;
