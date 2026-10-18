-- Integrity corrections. No operational data is changed or deleted.
-- Existing invalid data aborts validation; remediate only after a reviewed backup.
alter table public.chamada_diaria add constraint chamada_data_finita check (isfinite(data));
alter table public.chamada_diaria_auditoria add constraint chamada_auditoria_data_finita check (isfinite(data));
alter table public.banco_horas_medicoes add constraint banco_datas_finitas check (isfinite(data_medicao) and isfinite(aplica_a_partir_de));
alter table public.colaboradores add constraint colaborador_admissao_finita check (admissao is null or isfinite(admissao));
alter table public.lotes_importacao add constraint lote_referencia_finita check (data_referencia is null or isfinite(data_referencia));
alter table public.lotes_importacao drop constraint lotes_baseline_provenance_check;
alter table public.lotes_importacao add constraint lotes_baseline_provenance_check check (
  fonte is distinct from 'BASELINE_RH' or (
    tipo = 'EXCEL' and nome_arquivo is not null and nome_arquivo = 'Banco de dados RH.xlsx'
    and data_referencia is not null and isfinite(data_referencia)
    and source_hash is not null and source_hash ~ '^[0-9A-F]{64}$'
    and started_at is not null and isfinite(started_at)
    and completed_at is not null and isfinite(completed_at) and completed_at >= started_at
    and status = 'CONCLUIDO' and jsonb_typeof(warnings_agregados) = 'object'
  )
);


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
  if p_colaborador_id is null or p_data is null or not pg_catalog.isfinite(p_data) then
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
     or not pg_catalog.isfinite(p_data) or not pg_catalog.isfinite(p_inicio) or not pg_catalog.isfinite(p_fim)
     or p_fim < p_inicio or p_fim - p_inicio > 30 then
    raise exception using errcode = '22023', message = 'Intervalo de datas invalido';
  end if;

  select pg_catalog.jsonb_build_object(
    'date', p_data, 'startDate', p_inicio, 'endDate', p_fim,
    'employees', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', c.id, 'employeeNumber', c.matricula, 'name', c.nome,
      'unit', c.unidade_codigo, 'department', c.setor, 'role', c.funcao,
      'situation', c.situacao, 'manager', c.gestor_nome, 'admissionDate', c.admissao,
      'measurementDate', b.data_medicao, 'effectiveFrom', b.aplica_a_partir_de,
      'workdayHours', b.jornada_horas_dia, 'balanceMinutes', b.saldo_minutos,
      'balanceDays', b.saldo_dias,
      'usedCompensationDays', coalesce(b.dias_g_ciclo, 0),
      'pendingCompensationDays', b.dias_pendentes_compensar,
      'replacementDays', b.dias_repor,
      'attendance', coalesce(ch.registros, '[]'::jsonb)
    ) order by c.nome, c.matricula), '[]'::jsonb)
  ) into v_resultado
  from public.vw_colaboradores_mensurados c
  left join lateral private.banco_horas_no_dia(c.id, p_data) b on true
  left join lateral (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'date', cd.data, 'status', cd.status, 'observation', cd.observacao,
      'updatedAt', cd.updated_at
    ) order by cd.data) as registros
    from public.chamada_diaria cd
    where cd.colaborador_id = c.id and (cd.data between p_inicio and p_fim or cd.data = p_data)
  ) ch on true
  where v_role <> 'GESTOR' or (v_manager is not null and c.gestor_id = v_manager);
  return v_resultado;
end;
$$;

create or replace function chamada_privada.ler_banco_horas_atual_impl(p_data date)
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
    raise exception using errcode = '42501', message = 'Acesso nao autorizado ao Banco de Horas.';
  end if;
  if p_data is null or not pg_catalog.isfinite(p_data) then
    raise exception using errcode = '22023', message = 'Data de consulta obrigatoria.';
  end if;

  select pg_catalog.jsonb_build_object(
    'asOfDate', p_data,
    'employees', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', c.id, 'employeeNumber', c.matricula, 'name', c.nome,
      'unit', u.codigo, 'manager', g.nome, 'managerId', c.gestor_id,
      'department', c.setor, 'role', c.funcao, 'situation', c.situacao,
      'workdayHours', coalesce(b.jornada_horas_dia, c.jornada_horas_dia_atual),
      'measurementDate', b.data_medicao, 'effectiveFrom', b.aplica_a_partir_de,
      'measuredMinutes', b.saldo_minutos, 'measuredDays', b.saldo_dias,
      'usedCompensationDays', coalesce(b.dias_g_ciclo, 0),
      'pendingCompensationDays', b.dias_pendentes_compensar,
      'replacementDays', b.dias_repor,
      'effectiveDays', case when b.medicao_id is null then null
        when b.saldo_dias < 0 then -b.dias_repor
        else b.dias_pendentes_compensar end
    ) order by c.nome, c.matricula), '[]'::jsonb)
  ) into v_resultado
  from public.colaboradores c
  join public.unidades u on u.id = c.unidade_id
  left join public.gestores g on g.id = c.gestor_id
  left join lateral private.banco_horas_no_dia(c.id, p_data) b on true
  where v_role <> 'GESTOR' or (v_manager is not null and c.gestor_id = v_manager);

  return v_resultado;
end;
$$;

create or replace function private.listar_usuarios_impl(
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
      or (v_busca ~ '^[0-9. -]+$' and length(v_cpf_busca) = 11 and p.cpf_normalizado = v_cpf_busca)
    )
  order by
    case p.status_usuario when 'PENDENTE' then 0 when 'BLOQUEADO' then 1 else 2 end,
    p.created_at desc;
end;
$$;
