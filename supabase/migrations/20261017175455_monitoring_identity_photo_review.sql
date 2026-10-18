-- An external portrait can be reviewed before a binding, only by approved ADMIN/RH.
create function private.monitoring_identity_photo(p_source_id text, p_identity_value text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists (select 1 from public.perfis p where p.id=(select auth.uid())
    and p.status_usuario='APROVADO' and p.papel_usuario in ('ADMIN','RH')) then
    raise exception using errcode='42501', message='MONITORING_ADMIN_REQUIRED';
  end if;
  if p_source_id is null or length(p_source_id) not between 1 and 100
    or p_identity_value is null or length(p_identity_value) not between 1 and 100 then
    raise exception using errcode='22023', message='MONITORING_INVALID_IDENTITY';
  end if;
  select jsonb_build_object('mimeType',p.mime_type,'base64',p.base64,'sha256',p.sha256) into result
  from public.monitoring_sources requested
  join public.monitoring_sources source on source.identity_namespace=requested.identity_namespace
  join public.monitoring_photos p on p.source_id=source.id and p.identity_value=p_identity_value
  where requested.id=p_source_id and requested.kind in ('defense-person','defense-access')
    and source.kind='defense-person'
  order by (p.source_id=p_source_id) desc,p.source_id
  limit 1;
  return result;
end $$;
revoke all on function private.monitoring_identity_photo(text,text) from public,anon,authenticated,service_role;
grant execute on function private.monitoring_identity_photo(text,text) to authenticated;

create function public.monitoring_identity_photo(p_source_id text, p_identity_value text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.monitoring_identity_photo(p_source_id,p_identity_value);
$$;
revoke all on function public.monitoring_identity_photo(text,text) from public,anon,authenticated,service_role;
grant execute on function public.monitoring_identity_photo(text,text) to authenticated;
