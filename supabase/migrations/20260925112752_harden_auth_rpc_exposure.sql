alter function public.listar_usuarios(public.status_usuario, public.papel_usuario, text)
set schema private;
alter function private.listar_usuarios(public.status_usuario, public.papel_usuario, text)
rename to listar_usuarios_impl;

alter function public.aprovar_usuario(uuid, public.papel_usuario, uuid)
set schema private;
alter function private.aprovar_usuario(uuid, public.papel_usuario, uuid)
rename to aprovar_usuario_impl;

alter function public.bloquear_usuario(uuid)
set schema private;
alter function private.bloquear_usuario(uuid)
rename to bloquear_usuario_impl;

alter function public.reativar_usuario(uuid)
set schema private;
alter function private.reativar_usuario(uuid)
rename to reativar_usuario_impl;

alter function public.registrar_ultimo_acesso()
set schema private;
alter function private.registrar_ultimo_acesso()
rename to registrar_ultimo_acesso_impl;

create function public.listar_usuarios(
  p_status public.status_usuario default null,
  p_papel public.papel_usuario default null,
  p_busca text default null
)
returns table (
  id uuid,
  nome_completo text,
  cpf_mascarado text,
  status_usuario public.status_usuario,
  papel_usuario public.papel_usuario,
  gestor_id uuid,
  created_at timestamptz,
  aprovado_em timestamptz,
  bloqueado_em timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.listar_usuarios_impl(p_status, p_papel, p_busca)
$$;

create function public.aprovar_usuario(
  p_usuario_id uuid,
  p_papel public.papel_usuario,
  p_gestor_id uuid default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.aprovar_usuario_impl(p_usuario_id, p_papel, p_gestor_id)
$$;

create function public.bloquear_usuario(p_usuario_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.bloquear_usuario_impl(p_usuario_id)
$$;

create function public.reativar_usuario(p_usuario_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.reativar_usuario_impl(p_usuario_id)
$$;

create function public.registrar_ultimo_acesso()
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.registrar_ultimo_acesso_impl()
$$;

revoke all on function public.listar_usuarios(public.status_usuario, public.papel_usuario, text) from public, anon, authenticated;
revoke all on function public.aprovar_usuario(uuid, public.papel_usuario, uuid) from public, anon, authenticated;
revoke all on function public.bloquear_usuario(uuid) from public, anon, authenticated;
revoke all on function public.reativar_usuario(uuid) from public, anon, authenticated;
revoke all on function public.registrar_ultimo_acesso() from public, anon, authenticated;

grant execute on function public.listar_usuarios(public.status_usuario, public.papel_usuario, text) to authenticated;
grant execute on function public.aprovar_usuario(uuid, public.papel_usuario, uuid) to authenticated;
grant execute on function public.bloquear_usuario(uuid) to authenticated;
grant execute on function public.reativar_usuario(uuid) to authenticated;
grant execute on function public.registrar_ultimo_acesso() to authenticated;

comment on function public.listar_usuarios(public.status_usuario, public.papel_usuario, text)
is 'API invoker para fila administrativa; delega autorizacao a funcao privada.';
comment on function public.aprovar_usuario(uuid, public.papel_usuario, uuid)
is 'API invoker para aprovacao; regras de papel sao verificadas na funcao privada.';
comment on function public.bloquear_usuario(uuid)
is 'API invoker para bloqueio; regras de papel sao verificadas na funcao privada.';
comment on function public.reativar_usuario(uuid)
is 'API invoker para reativacao; regras de papel sao verificadas na funcao privada.';
comment on function public.registrar_ultimo_acesso()
is 'API invoker para registrar acesso do proprio usuario aprovado.';
