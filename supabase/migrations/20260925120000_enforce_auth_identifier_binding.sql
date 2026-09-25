-- Garante que uma criação direta em Auth não consiga associar um CPF a um
-- identificador técnico diferente daquele produzido pelo frontend.

create or replace function private.criar_perfil_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome_completo text := nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'nome_completo'), '');
  v_cpf_normalizado text := new.raw_user_meta_data ->> 'cpf_normalizado';
  v_email_esperado text;
begin
  if v_nome_completo is null then
    raise exception using errcode = '23514', message = 'nome completo ausente no cadastro';
  end if;

  if v_cpf_normalizado is null or v_cpf_normalizado !~ '^[0-9]{11}$' then
    raise exception using errcode = '23514', message = 'CPF normalizado invalido no cadastro';
  end if;

  v_email_esperado := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_cpf_normalizado, 'UTF8')),
    'hex'
  ) || '@auth.administrativo-cd.invalid';

  if pg_catalog.lower(coalesce(new.email, '')) <> v_email_esperado then
    raise exception using errcode = '23514', message = 'identificador tecnico invalido no cadastro';
  end if;

  insert into public.perfis (
    id,
    nome_completo,
    cpf_normalizado,
    status_usuario,
    papel_usuario
  ) values (
    new.id,
    v_nome_completo,
    v_cpf_normalizado,
    'PENDENTE',
    null
  );

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    - 'cpf_normalizado'
    - 'status_usuario'
    - 'papel_usuario'
  where id = new.id;

  return new;
end;
$$;

revoke all on function private.criar_perfil_novo_usuario() from public, anon, authenticated;
