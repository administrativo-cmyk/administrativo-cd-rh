-- Etapa 5E: role-scoped daily call without direct table grants or data changes.
-- Keep the exposed function invoker-only; the protected implementation stays private.
alter function public.ler_chamada_diaria(date,date,date) set schema chamada_privada;
alter function chamada_privada.ler_chamada_diaria(date,date,date) rename to ler_chamada_diaria_impl;

create or replace function chamada_privada.ler_chamada_diaria_impl(p_data date, p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.papel_usuario;
  v_manager uuid;
  v_resultado jsonb;
begin
  select p.papel_usuario, p.gestor_id into v_role, v_manager
  from public.perfis p
  where p.id = v_actor and p.status_usuario = 'APROVADO';

  if v_actor is null or not found or v_role not in ('ADMIN', 'RH', 'GESTOR', 'LEITURA') then
    raise exception using errcode = '42501', message = 'Acesso nao autorizado a Chamada Diaria.';
  end if;
  if p_data is null or p_inicio is null or p_fim is null
     or p_fim < p_inicio or p_fim - p_inicio > 30 then
    raise exception using errcode = '22023', message = 'Intervalo de datas invalido';
  end if;

  select pg_catalog.jsonb_build_object(
    'date', p_data, 'startDate', p_inicio, 'endDate', p_fim,
    'employees', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', c.id, 'employeeNumber', c.matricula, 'name', c.nome,
      'unit', c.unidade_codigo, 'department', c.setor, 'role', c.funcao,
      'situation', c.situacao, 'manager', c.gestor_nome, 'admissionDate', c.admissao,
      'measurementDate', m.data_medicao, 'effectiveFrom', m.aplica_a_partir_de,
      'workdayHours', m.jornada_horas_dia, 'balanceMinutes', m.saldo_minutos,
      'balanceDays', case when m.id is null then null
        else private.converter_saldo_minutos_em_dias(m.saldo_minutos, m.jornada_horas_dia) end,
      'usedCompensationDays', coalesce(g.dias_g, 0),
      'pendingCompensationDays', case when m.id is null then null
        else greatest(private.converter_saldo_minutos_em_dias(m.saldo_minutos, m.jornada_horas_dia) - coalesce(g.dias_g, 0), 0) end,
      'replacementDays', case when m.id is null then null
        else greatest(-private.converter_saldo_minutos_em_dias(m.saldo_minutos, m.jornada_horas_dia), 0) end,
      'attendance', coalesce(ch.registros, '[]'::jsonb)
    ) order by c.nome, c.matricula), '[]'::jsonb)
  ) into v_resultado
  from public.vw_colaboradores_mensurados c
  left join lateral (
    select med.id, med.data_medicao, med.aplica_a_partir_de,
           med.jornada_horas_dia, med.saldo_minutos
    from public.banco_horas_medicoes med
    where med.colaborador_id = c.id and med.aplica_a_partir_de <= p_data
    order by med.aplica_a_partir_de desc, med.data_medicao desc, med.created_at desc limit 1
  ) m on true
  left join lateral (
    select count(*)::integer as dias_g from public.chamada_diaria cd
    where cd.colaborador_id = c.id and cd.status = 'G'
      and cd.data >= m.aplica_a_partir_de and cd.data <= p_data
  ) g on true
  left join lateral (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'date', cd.data, 'status', cd.status, 'observation', cd.observacao,
      'updatedAt', cd.updated_at
    ) order by cd.data) as registros
    from public.chamada_diaria cd
    where cd.colaborador_id = c.id and cd.data between p_inicio and p_fim
  ) ch on true
  where v_role <> 'GESTOR' or (v_manager is not null and c.gestor_id = v_manager);
  return v_resultado;
end;
$$;
revoke all on function chamada_privada.ler_chamada_diaria_impl(date,date,date) from public, anon, authenticated;
grant execute on function chamada_privada.ler_chamada_diaria_impl(date,date,date) to authenticated;

create function public.ler_chamada_diaria(p_data date, p_inicio date, p_fim date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select chamada_privada.ler_chamada_diaria_impl(p_data, p_inicio, p_fim)
$$;
revoke all on function public.ler_chamada_diaria(date,date,date) from public, anon, authenticated;
grant execute on function public.ler_chamada_diaria(date,date,date) to authenticated;

-- The save body intentionally preserves Etapa 5D's optimistic concurrency,
-- audit, G handling and clear semantics. Only authorization is broadened.
create or replace function chamada_privada.salvar_chamada_diaria(
  p_colaborador_id uuid, p_data date, p_status public.codigo_chamada,
  p_observacao text, p_expected_updated_at timestamptz
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.papel_usuario;
  v_manager uuid;
  v_employee_manager uuid;
  v_observacao text := nullif(btrim(p_observacao), '');
  v_existing public.chamada_diaria%rowtype;
  v_saved public.chamada_diaria%rowtype;
begin
  select p.papel_usuario, p.gestor_id into v_role, v_manager
  from public.perfis p
  where p.id = v_actor and p.status_usuario = 'APROVADO'
  for share;
  if v_actor is null or not found or v_role not in ('ADMIN', 'RH', 'GESTOR') then
    raise exception using errcode = '42501', message = 'Acesso nao autorizado a Chamada Diaria.';
  end if;
  if p_colaborador_id is null or p_data is null then
    raise exception using errcode = '22023', message = 'Colaborador e data sao obrigatorios.';
  end if;

  -- A row lock serializes manager reassignment with this mutation. The current
  -- relationship is checked here, never from a browser snapshot or unit.
  select c.gestor_id into v_employee_manager
  from public.colaboradores c
  where c.id = p_colaborador_id and c.ativo_no_sistema
    and c.situacao in ('ATIVO', 'FERIAS', 'NOVO_ADMITIDO')
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'Colaborador fora da populacao operacional.';
  end if;
  if v_role = 'GESTOR' and (v_manager is null or v_employee_manager is distinct from v_manager) then
    raise exception using errcode = '42501', message = 'Colaborador fora da equipe do gestor.';
  end if;
  if length(v_observacao) > 500 then
    raise exception using errcode = '22023', message = 'A observacao deve ter no maximo 500 caracteres.';
  end if;
  if p_status is null and v_observacao is not null then
    raise exception using errcode = '22023', message = 'Selecione um status antes de adicionar observacao.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_colaborador_id::text), pg_catalog.hashtext(p_data::text)
  );
  select * into v_existing from public.chamada_diaria
  where colaborador_id = p_colaborador_id and data = p_data for update;

  if v_existing.id is null then
    if p_expected_updated_at is not null then
      raise exception using errcode = 'PT409', message = 'Este lancamento foi alterado por outro usuario. Atualize os dados e tente novamente.';
    end if;
    if p_status is null then
      return pg_catalog.jsonb_build_object('changed', false, 'record', null);
    end if;
    insert into public.chamada_diaria (colaborador_id, data, status, observacao, created_by, updated_by)
    values (p_colaborador_id, p_data, p_status, v_observacao, v_actor, v_actor)
    returning * into v_saved;
    insert into public.chamada_diaria_auditoria
      (chamada_id, colaborador_id, data, status_novo, observacao_nova, operacao, alterado_por)
    values (v_saved.id, p_colaborador_id, p_data, p_status, v_observacao, 'INSERT', v_actor);
  else
    if v_existing.status is not distinct from p_status
       and v_existing.observacao is not distinct from v_observacao then
      return pg_catalog.jsonb_build_object('changed', false, 'record',
        pg_catalog.jsonb_build_object('date', v_existing.data, 'status', v_existing.status,
          'observation', v_existing.observacao, 'updatedAt', v_existing.updated_at));
    end if;
    if p_expected_updated_at is null or v_existing.updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = 'PT409', message = 'Este lancamento foi alterado por outro usuario. Atualize os dados e tente novamente.';
    end if;
    if p_status is null then
      delete from public.chamada_diaria where id = v_existing.id;
      insert into public.chamada_diaria_auditoria
        (chamada_id, colaborador_id, data, status_anterior, observacao_anterior, operacao, alterado_por)
      values (v_existing.id, p_colaborador_id, p_data, v_existing.status, v_existing.observacao, 'CLEAR', v_actor);
      return pg_catalog.jsonb_build_object('changed', true, 'record', null);
    end if;
    update public.chamada_diaria
    set status = p_status, observacao = v_observacao, updated_by = v_actor
    where id = v_existing.id returning * into v_saved;
    insert into public.chamada_diaria_auditoria
      (chamada_id, colaborador_id, data, status_anterior, status_novo,
       observacao_anterior, observacao_nova, operacao, alterado_por)
    values (v_existing.id, p_colaborador_id, p_data, v_existing.status, p_status,
      v_existing.observacao, v_observacao, 'UPDATE', v_actor);
  end if;
  return pg_catalog.jsonb_build_object('changed', true, 'record',
    pg_catalog.jsonb_build_object('date', v_saved.data, 'status', v_saved.status,
      'observation', v_saved.observacao, 'updatedAt', v_saved.updated_at));
end;
$$;
revoke all on function chamada_privada.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)
  from public, anon, authenticated;
grant execute on function chamada_privada.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)
  to authenticated;

-- Manager assignment is an administrative operation, separate from call access.
create table private.perfis_gestor_auditoria (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null,
  gestor_anterior_id uuid,
  gestor_novo_id uuid not null,
  alterado_por uuid not null,
  alterado_em timestamptz not null default clock_timestamp()
);
create index perfis_gestor_auditoria_usuario_idx
  on private.perfis_gestor_auditoria (usuario_id, alterado_em desc);
alter table private.perfis_gestor_auditoria enable row level security;
revoke all on table private.perfis_gestor_auditoria from public, anon, authenticated;

create or replace function private.aprovar_usuario_impl(
  p_usuario_id uuid, p_papel public.papel_usuario, p_gestor_id uuid default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_chamador_id uuid := (select auth.uid());
  v_chamador_status public.status_usuario;
  v_chamador_papel public.papel_usuario;
  v_alvo public.perfis%rowtype;
begin
  select p.status_usuario, p.papel_usuario into v_chamador_status, v_chamador_papel
  from public.perfis p where p.id = v_chamador_id;
  if v_chamador_status is distinct from 'APROVADO'
    or v_chamador_papel is null or v_chamador_papel not in ('ADMIN', 'RH') then
    raise exception using errcode = '42501', message = 'aprovacao nao autorizada';
  end if;
  if p_usuario_id = v_chamador_id then
    raise exception using errcode = '42501', message = 'autoaprovacao nao permitida';
  end if;
  select p.* into v_alvo from public.perfis p where p.id = p_usuario_id for update;
  if not found or v_alvo.status_usuario <> 'PENDENTE' then
    raise exception using errcode = 'P0002', message = 'usuario pendente nao encontrado';
  end if;
  if p_papel is null then
    raise exception using errcode = '23502', message = 'papel obrigatorio para aprovacao';
  end if;
  if v_chamador_papel = 'RH' and p_papel not in ('GESTOR', 'LEITURA') then
    raise exception using errcode = '42501', message = 'RH nao pode atribuir este papel';
  end if;
  if p_papel = 'GESTOR' then
    if p_gestor_id is null or not exists (
      select 1 from public.gestores g where g.id = p_gestor_id and g.ativo
    ) then
      raise exception using errcode = '23514', message = 'Gestor do quadro ativo e obrigatorio';
    end if;
  elsif p_gestor_id is not null then
    raise exception using errcode = '23514', message = 'vinculo permitido somente para papel GESTOR';
  end if;
  update public.perfis set
    status_usuario = 'APROVADO', papel_usuario = p_papel,
    gestor_id = case when p_papel = 'GESTOR' then p_gestor_id else null end,
    aprovado_em = now(), aprovado_por = v_chamador_id,
    bloqueado_em = null, bloqueado_por = null
  where id = p_usuario_id;
  if p_papel = 'GESTOR' then
    insert into private.perfis_gestor_auditoria (usuario_id, gestor_novo_id, alterado_por)
    values (p_usuario_id, p_gestor_id, v_chamador_id);
  end if;
end;
$$;
revoke all on function private.aprovar_usuario_impl(uuid,public.papel_usuario,uuid)
  from public, anon, authenticated;
grant execute on function private.aprovar_usuario_impl(uuid,public.papel_usuario,uuid)
  to authenticated;

create function private.listar_gestores_quadro_impl()
returns table (id uuid, nome text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.perfis p where p.id = (select auth.uid())
      and p.status_usuario = 'APROVADO' and p.papel_usuario in ('ADMIN', 'RH')
  ) then
    raise exception using errcode = '42501', message = 'consulta de gestores nao autorizada';
  end if;
  return query select g.id, g.nome from public.gestores g where g.ativo order by g.nome, g.id;
end;
$$;
revoke all on function private.listar_gestores_quadro_impl() from public, anon, authenticated;
grant execute on function private.listar_gestores_quadro_impl() to authenticated;

create function public.listar_gestores_quadro()
returns table (id uuid, nome text)
language sql stable security invoker set search_path = '' as $$
  select * from private.listar_gestores_quadro_impl()
$$;
revoke all on function public.listar_gestores_quadro() from public, anon, authenticated;
grant execute on function public.listar_gestores_quadro() to authenticated;

create function private.vincular_gestor_usuario_impl(p_usuario_id uuid, p_gestor_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_target public.perfis%rowtype;
begin
  if v_actor is null or not exists (
    select 1 from public.perfis p where p.id = v_actor
      and p.status_usuario = 'APROVADO' and p.papel_usuario in ('ADMIN', 'RH')
  ) then
    raise exception using errcode = '42501', message = 'vinculo de gestor nao autorizado';
  end if;
  if p_gestor_id is null or not exists (
    select 1 from public.gestores g where g.id = p_gestor_id and g.ativo
  ) then
    raise exception using errcode = '23514', message = 'gestor do quadro ativo obrigatorio';
  end if;
  select p.* into v_target from public.perfis p where p.id = p_usuario_id for update;
  if not found or v_target.papel_usuario <> 'GESTOR' or v_target.status_usuario = 'PENDENTE' then
    raise exception using errcode = '42501', message = 'vinculo permitido somente a usuario GESTOR';
  end if;
  if v_target.gestor_id is distinct from p_gestor_id then
    update public.perfis set gestor_id = p_gestor_id where id = p_usuario_id;
    insert into private.perfis_gestor_auditoria
      (usuario_id, gestor_anterior_id, gestor_novo_id, alterado_por)
    values (p_usuario_id, v_target.gestor_id, p_gestor_id, v_actor);
  end if;
end;
$$;
revoke all on function private.vincular_gestor_usuario_impl(uuid,uuid) from public, anon, authenticated;
grant execute on function private.vincular_gestor_usuario_impl(uuid,uuid) to authenticated;

create function public.vincular_gestor_usuario(p_usuario_id uuid, p_gestor_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.vincular_gestor_usuario_impl(p_usuario_id, p_gestor_id)
$$;
revoke all on function public.vincular_gestor_usuario(uuid,uuid) from public, anon, authenticated;
grant execute on function public.vincular_gestor_usuario(uuid,uuid) to authenticated;

create or replace function private.reativar_usuario_impl(p_usuario_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_chamador_id uuid := (select auth.uid());
  v_chamador_status public.status_usuario;
  v_chamador_papel public.papel_usuario;
  v_alvo public.perfis%rowtype;
begin
  select p.status_usuario, p.papel_usuario into v_chamador_status, v_chamador_papel
  from public.perfis p where p.id = v_chamador_id;
  if v_chamador_status is distinct from 'APROVADO'
    or v_chamador_papel is null or v_chamador_papel not in ('ADMIN', 'RH') then
    raise exception using errcode = '42501', message = 'reativacao nao autorizada';
  end if;
  if p_usuario_id = v_chamador_id then
    raise exception using errcode = '42501', message = 'autorreativacao nao permitida';
  end if;
  select p.* into v_alvo from public.perfis p where p.id = p_usuario_id for update;
  if not found or v_alvo.status_usuario <> 'BLOQUEADO' or v_alvo.papel_usuario is null then
    raise exception using errcode = 'P0002', message = 'usuario bloqueado nao encontrado';
  end if;
  if v_chamador_papel = 'RH' and v_alvo.papel_usuario not in ('GESTOR', 'LEITURA') then
    raise exception using errcode = '42501', message = 'RH nao pode reativar este usuario';
  end if;
  if v_alvo.papel_usuario = 'GESTOR' and v_alvo.gestor_id is null then
    raise exception using errcode = '23514', message = 'vincule o gestor do quadro antes de reativar';
  end if;
  update public.perfis set status_usuario = 'APROVADO', aprovado_em = now(),
    aprovado_por = v_chamador_id, bloqueado_em = null, bloqueado_por = null
  where id = p_usuario_id;
end;
$$;
revoke all on function private.reativar_usuario_impl(uuid) from public, anon, authenticated;
grant execute on function private.reativar_usuario_impl(uuid) to authenticated;
