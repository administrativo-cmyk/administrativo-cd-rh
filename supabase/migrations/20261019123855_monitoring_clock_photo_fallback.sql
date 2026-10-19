-- Employee photos retain their real source. Defense portraits always take
-- precedence; an AFD-source portrait identified by CPF is a fallback only.
-- Bindings remain mandatory, date-bound, typed and namespace-isolated.
create or replace function private.monitoring_employee_photo(p_employee uuid)
returns jsonb language sql stable security invoker set search_path='' as $function$
 select jsonb_build_object('mimeType',p.mime_type,'base64',p.base64,'sha256',p.sha256)
 from public.monitoring_bindings b
 join public.monitoring_sources bs on bs.id=b.source_id
 join public.monitoring_sources ps on ps.identity_namespace=bs.identity_namespace
 join public.monitoring_photos p on p.source_id=ps.id and p.identity_value=b.identity_value
 where b.employee_id=p_employee and b.revoked_at is null
   and (now() at time zone 'America/Sao_Paulo')::date between b.valid_from and coalesce(b.valid_to,'9999-12-31')
   and ((b.identity_type='defense' and bs.kind in ('defense-person','defense-access') and ps.kind in ('defense-person','defense-access'))
     or (b.identity_type='cpf' and bs.kind='afd' and ps.kind='afd' and private.monitoring_identifier_valid(b.identity_value,'cpf')))
 order by case b.identity_type when 'defense' then 0 else 1 end,
   p.updated_at desc,p.source_id,p.identity_value,b.id
 limit 1;
$function$;
-- Only the existing authorized RPC implementation invokes this helper.
revoke all on function private.monitoring_employee_photo(uuid) from public,anon,authenticated,service_role;

-- Replace only the two photo lookups; keep all authorization, profile-link,
-- attendance, calculation and administrative branches unchanged. Reapplication
-- is safe and an unexpected upstream body causes a visible migration failure.
do $migration$
declare
 definition text;
 old_lookup text:=$old$select jsonb_build_object('mimeType',p.mime_type,'base64',p.base64,'sha256',p.sha256) into result from public.monitoring_photos p
   join public.monitoring_bindings b on (select identity_namespace from public.monitoring_sources where id=b.source_id)=(select identity_namespace from public.monitoring_sources where id=p.source_id) and b.identity_type='defense' and b.identity_value=p.identity_value
   where b.employee_id=employee and b.revoked_at is null and (now() at time zone 'America/Sao_Paulo')::date between b.valid_from and coalesce(b.valid_to,'9999-12-31') order by p.updated_at desc limit 1;$old$;
 new_lookup text:='select private.monitoring_employee_photo(employee) into result;';
 old_matches integer;
 new_matches integer;
begin
 definition:=pg_get_functiondef('private.monitoring_query_impl(text,jsonb)'::regprocedure);
 old_matches:=(length(definition)-length(replace(definition,old_lookup,'')))/length(old_lookup);
 new_matches:=(length(definition)-length(replace(definition,new_lookup,'')))/length(new_lookup);
 if old_matches=0 and new_matches=2 then return; end if;
 if old_matches<>2 or new_matches<>0 then raise exception 'CLOCK_PHOTO_UNEXPECTED_QUERY_DEFINITION'; end if;
 execute replace(definition,old_lookup,new_lookup);
end;
$migration$;
