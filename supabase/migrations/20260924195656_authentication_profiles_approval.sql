create type public.status_usuario as enum (
  'PENDENTE',
  'APROVADO',
  'BLOQUEADO'
);

create type public.papel_usuario as enum (
  'ADMIN',
  'RH',
  'GESTOR',
  'LEITURA'
);

create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome_completo text not null,
  cpf_normalizado text not null,
  status_usuario public.status_usuario not null default 'PENDENTE',
  papel_usuario public.papel_usuario,
  gestor_id uuid references public.gestores(id) on delete set null,
  aprovado_em timestamptz,
  aprovado_por uuid,
  bloqueado_em timestamptz,
  bloqueado_por uuid,
  ultimo_acesso_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint perfis_cpf_normalizado_unique unique (cpf_normalizado),
  constraint perfis_nome_completo_not_blank check (btrim(nome_completo) <> ''),
  constraint perfis_cpf_normalizado_format check (cpf_normalizado ~ '^[0-9]{11}$'),
  constraint perfis_gestor_only_for_manager check (gestor_id is null or papel_usuario = 'GESTOR'),
  constraint perfis_pending_state check (
    status_usuario <> 'PENDENTE'
    or (
      papel_usuario is null
      and aprovado_em is null
      and aprovado_por is null
      and bloqueado_em is null
      and bloqueado_por is null
    )
  ),
  constraint perfis_approved_state check (
    status_usuario <> 'APROVADO'
    or (papel_usuario is not null and aprovado_em is not null)
  ),
  constraint perfis_blocked_state check (
    status_usuario <> 'BLOQUEADO'
    or (papel_usuario is not null and bloqueado_em is not null and bloqueado_por is not null)
  )
);

alter table public.perfis
  add constraint perfis_aprovado_por_fkey
  foreign key (aprovado_por) references public.perfis(id) on delete set null;

alter table public.perfis
  add constraint perfis_bloqueado_por_fkey
  foreign key (bloqueado_por) references public.perfis(id) on delete set null;

create index perfis_status_created_at_idx
on public.perfis (status_usuario, created_at desc);

create index perfis_papel_status_idx
on public.perfis (papel_usuario, status_usuario)
where papel_usuario is not null;

create index perfis_gestor_id_idx
on public.perfis (gestor_id)
where gestor_id is not null;

create index perfis_aprovado_por_idx
on public.perfis (aprovado_por)
where aprovado_por is not null;

create index perfis_bloqueado_por_idx
on public.perfis (bloqueado_por)
where bloqueado_por is not null;

create trigger perfis_definir_updated_at
before update on public.perfis
for each row execute function private.definir_updated_at();

create or replace function private.criar_perfil_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome_completo text := nullif(btrim(new.raw_user_meta_data ->> 'nome_completo'), '');
  v_cpf_normalizado text := new.raw_user_meta_data ->> 'cpf_normalizado';
begin
  if v_nome_completo is null then
    raise exception using errcode = '23514', message = 'nome completo ausente no cadastro';
  end if;

  if v_cpf_normalizado is null or v_cpf_normalizado !~ '^[0-9]{11}$' then
    raise exception using errcode = '23514', message = 'CPF normalizado invalido no cadastro';
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
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'cpf_normalizado' - 'status_usuario' - 'papel_usuario'
  where id = new.id;

  return new;
end;
$$;

revoke all on function private.criar_perfil_novo_usuario() from public, anon, authenticated;

create trigger auth_user_criar_perfil
after insert on auth.users
for each row execute function private.criar_perfil_novo_usuario();

create or replace function private.status_usuario_atual()
returns public.status_usuario
language sql
stable
security definer
set search_path = ''
as $$
  select p.status_usuario
  from public.perfis p
  where p.id = (select auth.uid())
$$;

create or replace function private.papel_usuario_atual()
returns public.papel_usuario
language sql
stable
security definer
set search_path = ''
as $$
  select p.papel_usuario
  from public.perfis p
  where p.id = (select auth.uid())
$$;

create or replace function private.usuario_admin_ou_rh()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.status_usuario_atual()) = 'APROVADO'
    and (select private.papel_usuario_atual()) in ('ADMIN', 'RH'),
    false
  )
$$;

revoke all on function private.status_usuario_atual() from public, anon, authenticated;
revoke all on function private.papel_usuario_atual() from public, anon, authenticated;
revoke all on function private.usuario_admin_ou_rh() from public, anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.status_usuario_atual() to authenticated;
grant execute on function private.papel_usuario_atual() to authenticated;
grant execute on function private.usuario_admin_ou_rh() to authenticated;

alter table public.perfis enable row level security;

revoke all on table public.perfis from anon, authenticated;
grant select (
  id,
  nome_completo,
  status_usuario,
  papel_usuario,
  gestor_id,
  ultimo_acesso_em,
  created_at,
  updated_at
) on public.perfis to authenticated;

create policy perfis_select_proprio
on public.perfis
for select
to authenticated
using ((select auth.uid()) = id);

create or replace function public.listar_usuarios(
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
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_busca text := nullif(btrim(coalesce(p_busca, '')), '');
  v_cpf_busca text := nullif(pg_catalog.regexp_replace(coalesce(p_busca, ''), '[^0-9]', '', 'g'), '');
begin
  if not private.usuario_admin_ou_rh() then
    raise exception using errcode = '42501', message = 'acesso administrativo nao autorizado';
  end if;

  return query
  select
    p.id,
    p.nome_completo,
    '***.***.***-' || pg_catalog.right(p.cpf_normalizado, 2),
    p.status_usuario,
    p.papel_usuario,
    p.gestor_id,
    p.created_at,
    p.aprovado_em,
    p.bloqueado_em
  from public.perfis p
  where (p_status is null or p.status_usuario = p_status)
    and (p_papel is null or p.papel_usuario = p_papel)
    and (
      v_busca is null
      or p.nome_completo ilike '%' || v_busca || '%'
      or (v_cpf_busca is not null and p.cpf_normalizado like '%' || v_cpf_busca || '%')
    )
  order by
    case p.status_usuario when 'PENDENTE' then 0 when 'BLOQUEADO' then 1 else 2 end,
    p.created_at desc;
end;
$$;

create or replace function public.aprovar_usuario(
  p_usuario_id uuid,
  p_papel public.papel_usuario,
  p_gestor_id uuid default null
)
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
  select p.status_usuario, p.papel_usuario
  into v_chamador_status, v_chamador_papel
  from public.perfis p
  where p.id = v_chamador_id;

  if v_chamador_status is distinct from 'APROVADO'
    or v_chamador_papel is null
    or v_chamador_papel not in ('ADMIN', 'RH') then
    raise exception using errcode = '42501', message = 'aprovacao nao autorizada';
  end if;

  if p_usuario_id = v_chamador_id then
    raise exception using errcode = '42501', message = 'autoaprovacao nao permitida';
  end if;

  select p.* into v_alvo
  from public.perfis p
  where p.id = p_usuario_id
  for update;

  if not found or v_alvo.status_usuario <> 'PENDENTE' then
    raise exception using errcode = 'P0002', message = 'usuario pendente nao encontrado';
  end if;

  if p_papel is null then
    raise exception using errcode = '23502', message = 'papel obrigatorio para aprovacao';
  end if;

  if v_chamador_papel = 'RH' and p_papel not in ('GESTOR', 'LEITURA') then
    raise exception using errcode = '42501', message = 'RH nao pode atribuir este papel';
  end if;

  if p_papel <> 'GESTOR' and p_gestor_id is not null then
    raise exception using errcode = '23514', message = 'vinculo de gestor permitido somente para papel GESTOR';
  end if;

  update public.perfis
  set
    status_usuario = 'APROVADO',
    papel_usuario = p_papel,
    gestor_id = case when p_papel = 'GESTOR' then p_gestor_id else null end,
    aprovado_em = now(),
    aprovado_por = v_chamador_id,
    bloqueado_em = null,
    bloqueado_por = null
  where id = p_usuario_id;
end;
$$;

create or replace function public.bloquear_usuario(p_usuario_id uuid)
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

  update public.perfis
  set
    status_usuario = 'BLOQUEADO',
    bloqueado_em = now(),
    bloqueado_por = v_chamador_id
  where id = p_usuario_id;
end;
$$;

create or replace function public.reativar_usuario(p_usuario_id uuid)
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
  select p.status_usuario, p.papel_usuario
  into v_chamador_status, v_chamador_papel
  from public.perfis p
  where p.id = v_chamador_id;

  if v_chamador_status is distinct from 'APROVADO'
    or v_chamador_papel is null
    or v_chamador_papel not in ('ADMIN', 'RH') then
    raise exception using errcode = '42501', message = 'reativacao nao autorizada';
  end if;

  if p_usuario_id = v_chamador_id then
    raise exception using errcode = '42501', message = 'autorreativacao nao permitida';
  end if;

  select p.* into v_alvo
  from public.perfis p
  where p.id = p_usuario_id
  for update;

  if not found or v_alvo.status_usuario <> 'BLOQUEADO' or v_alvo.papel_usuario is null then
    raise exception using errcode = 'P0002', message = 'usuario bloqueado nao encontrado';
  end if;

  if v_chamador_papel = 'RH' and v_alvo.papel_usuario not in ('GESTOR', 'LEITURA') then
    raise exception using errcode = '42501', message = 'RH nao pode reativar este usuario';
  end if;

  update public.perfis
  set
    status_usuario = 'APROVADO',
    aprovado_em = now(),
    aprovado_por = v_chamador_id,
    bloqueado_em = null,
    bloqueado_por = null
  where id = p_usuario_id;
end;
$$;

create or replace function public.registrar_ultimo_acesso()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or (select private.status_usuario_atual()) <> 'APROVADO' then
    raise exception using errcode = '42501', message = 'registro de acesso nao autorizado';
  end if;

  update public.perfis
  set ultimo_acesso_em = now()
  where id = auth.uid();
end;
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
