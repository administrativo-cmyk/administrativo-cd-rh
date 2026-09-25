begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('91000000-0000-0000-0000-000000000001', encode(sha256(convert_to('00000000101', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Admin SQL","cpf_normalizado":"00000000101"}'),
  ('91000000-0000-0000-0000-000000000002', encode(sha256(convert_to('00000000102', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"RH SQL","cpf_normalizado":"00000000102"}'),
  ('91000000-0000-0000-0000-000000000003', encode(sha256(convert_to('00000000103', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Gestor SQL","cpf_normalizado":"00000000103"}'),
  ('91000000-0000-0000-0000-000000000004', encode(sha256(convert_to('00000000104', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Leitura SQL","cpf_normalizado":"00000000104"}'),
  ('91000000-0000-0000-0000-000000000005', encode(sha256(convert_to('00000000105', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Admin Alvo SQL","cpf_normalizado":"00000000105"}'),
  ('91000000-0000-0000-0000-000000000006', encode(sha256(convert_to('00000000106', 'UTF8')), 'hex') || '@auth.administrativo-cd.invalid', '{"nome_completo":"Segundo Admin SQL","cpf_normalizado":"00000000106"}');

do $$
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data)
    values (
      '91000000-0000-0000-0000-000000000099',
      'identificador-invalido@auth.administrativo-cd.invalid',
      '{"nome_completo":"Identidade Invalida SQL","cpf_normalizado":"00000000199"}'
    );
    raise exception 'identificador técnico divergente foi aceito';
  exception
    when check_violation then null;
  end;
end;
$$;

do $$
declare
  v_admin_count integer;
  v_last_admin_id uuid;
begin
  select count(*) into v_admin_count
  from public.perfis
  where status_usuario = 'APROVADO' and papel_usuario = 'ADMIN';

  if v_admin_count = 1 then
    select id into v_last_admin_id
    from public.perfis
    where status_usuario = 'APROVADO' and papel_usuario = 'ADMIN';

    begin
      perform private.assert_active_admin_remains(v_last_admin_id);
      raise exception 'a protecao permitiu remover o ultimo ADMIN aprovado';
    exception
      when check_violation then null;
    end;
  elsif v_admin_count <> 0 then
    raise exception 'precondicao inesperada: esperado zero ou um ADMIN aprovado antes dos testes';
  end if;
end;
$$;

update public.perfis
set status_usuario = 'APROVADO', papel_usuario = 'ADMIN', aprovado_em = now()
where id = '91000000-0000-0000-0000-000000000001';

update public.perfis
set status_usuario = 'APROVADO', papel_usuario = 'RH', aprovado_em = now()
where id = '91000000-0000-0000-0000-000000000002';

update public.perfis
set status_usuario = 'APROVADO', papel_usuario = 'ADMIN', aprovado_em = now()
where id = '91000000-0000-0000-0000-000000000006';

do $$
declare
  v_pending_count integer;
  v_cpf_in_metadata boolean;
begin
  select count(*) into v_pending_count
  from public.perfis
  where id in (
    '91000000-0000-0000-0000-000000000003',
    '91000000-0000-0000-0000-000000000004'
  )
    and status_usuario = 'PENDENTE'
    and papel_usuario is null;

  if v_pending_count <> 2 then
    raise exception 'perfil nao nasceu PENDENTE e sem papel';
  end if;

  select raw_user_meta_data ? 'cpf_normalizado' into v_cpf_in_metadata
  from auth.users
  where id = '91000000-0000-0000-0000-000000000003';

  if v_cpf_in_metadata then
    raise exception 'CPF permaneceu duplicado em user_metadata';
  end if;

  if has_column_privilege('authenticated', 'public.perfis', 'papel_usuario', 'UPDATE') then
    raise exception 'authenticated recebeu UPDATE de papel_usuario';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000002', true);

do $$
begin
  begin
    perform public.aprovar_usuario(
      '91000000-0000-0000-0000-000000000005',
      'ADMIN',
      null
    );
    raise exception 'RH promoveu ADMIN indevidamente';
  exception
    when insufficient_privilege then null;
  end;

  perform public.aprovar_usuario(
    '91000000-0000-0000-0000-000000000003',
    'GESTOR',
    null
  );

  perform public.aprovar_usuario(
    '91000000-0000-0000-0000-000000000004',
    'LEITURA',
    null
  );

  perform public.bloquear_usuario('91000000-0000-0000-0000-000000000003');
  perform public.reativar_usuario('91000000-0000-0000-0000-000000000003');
end;
$$;

select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
set local role authenticated;

do $$
declare
  v_admin_count integer;
begin
  begin
    perform public.bloquear_usuario('91000000-0000-0000-0000-000000000001');
    raise exception 'ADMIN conseguiu autobloqueio';
  exception
    when insufficient_privilege then null;
  end;

  perform public.bloquear_usuario('91000000-0000-0000-0000-000000000006');

  select count(*) into v_admin_count
  from public.perfis
  where status_usuario = 'APROVADO' and papel_usuario = 'ADMIN';

  if v_admin_count <> 1 then
    raise exception 'bloqueio do outro ADMIN nao preservou exatamente um ADMIN aprovado';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000006', true);
set local role authenticated;

do $$
begin
  begin
    perform public.bloquear_usuario('91000000-0000-0000-0000-000000000001');
    raise exception 'ADMIN bloqueado manteve capacidade administrativa';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select 1 / case when count(id) = 1 then 1 else 0 end as own_profile_rls_ok
from public.perfis;

reset role;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select 1 / case
  when count(*) = 6
    and bool_and(cpf_mascarado ~ '^\*\*\*\.\*\*\*\.\*\*\*-[0-9]{2}$')
  then 1 else 0 end as administrative_masking_ok
from public.listar_usuarios(null, null, null)
where id in (
  '91000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000002',
  '91000000-0000-0000-0000-000000000003',
  '91000000-0000-0000-0000-000000000004',
  '91000000-0000-0000-0000-000000000005',
  '91000000-0000-0000-0000-000000000006'
);

reset role;

select 'auth_rls_transactional_tests_passed' as result;

rollback;
