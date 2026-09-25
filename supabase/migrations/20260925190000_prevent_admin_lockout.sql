-- Serialize every administrative block decision before reading the actor or target.
-- This prevents two active admins from concurrently blocking one another.
create or replace function private.assert_active_admin_remains(p_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alvo_e_admin boolean;
  v_admins_aprovados bigint;
begin
  select p.status_usuario = 'APROVADO' and p.papel_usuario = 'ADMIN'
  into v_alvo_e_admin
  from public.perfis p
  where p.id = p_usuario_id;

  if coalesce(v_alvo_e_admin, false) then
    select count(*)
    into v_admins_aprovados
    from public.perfis p
    where p.status_usuario = 'APROVADO'
      and p.papel_usuario = 'ADMIN';

    if v_admins_aprovados <= 1 then
      raise exception using
        errcode = '23514',
        message = 'nao e possivel bloquear o ultimo administrador ativo';
    end if;
  end if;
end;
$$;

revoke all on function private.assert_active_admin_remains(uuid) from public, anon, authenticated;

create or replace function private.bloquear_usuario_impl(p_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chamador_id uuid := auth.uid();
  v_chamador_status public.status_usuario;
  v_chamador_papel public.papel_usuario;
  v_alvo public.perfis%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(824202609, 1);

  select p.status_usuario, p.papel_usuario
  into v_chamador_status, v_chamador_papel
  from public.perfis p
  where p.id = v_chamador_id;

  if v_chamador_status is distinct from 'APROVADO'
    or v_chamador_papel is null
    or v_chamador_papel not in ('ADMIN', 'RH') then
    raise exception using errcode = '42501', message = 'bloqueio nao autorizado';
  end if;

  if p_usuario_id = v_chamador_id then
    raise exception using errcode = '42501', message = 'autobloqueio nao permitido';
  end if;

  select p.* into v_alvo
  from public.perfis p
  where p.id = p_usuario_id
  for update;

  if not found or v_alvo.status_usuario <> 'APROVADO' then
    raise exception using errcode = 'P0002', message = 'usuario aprovado nao encontrado';
  end if;

  if v_chamador_papel = 'RH' and v_alvo.papel_usuario not in ('GESTOR', 'LEITURA') then
    raise exception using errcode = '42501', message = 'RH nao pode bloquear este usuario';
  end if;

  perform private.assert_active_admin_remains(p_usuario_id);

  update public.perfis
  set
    status_usuario = 'BLOQUEADO',
    bloqueado_em = now(),
    bloqueado_por = v_chamador_id
  where id = p_usuario_id;
end;
$$;

comment on function private.bloquear_usuario_impl(uuid)
is 'Bloqueia acessos sob advisory transaction lock, recusando autobloqueio e bloqueio do ultimo ADMIN aprovado.';
