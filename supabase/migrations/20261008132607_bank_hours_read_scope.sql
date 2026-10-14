-- Etapa 6B: one as-of-date bank calculation shared by Daily Call and Time Bank.
-- The helper remains private and invoker-only; exposed reads perform their own
-- approved-profile and manager-scope checks before returning any employee data.
create function private.banco_horas_no_dia(p_colaborador_id uuid, p_data date)
returns table (
  medicao_id uuid,
  data_medicao date,
  aplica_a_partir_de date,
  jornada_horas_dia numeric,
  saldo_minutos integer,
  saldo_dias integer,
  dias_g_ciclo integer,
  dias_pendentes_compensar integer,
  dias_repor integer
)
language sql stable security invoker set search_path = '' as $$
  with medicao as (
    select m.id, m.data_medicao, m.aplica_a_partir_de,
           m.jornada_horas_dia, m.saldo_minutos
    from public.banco_horas_medicoes m
    where m.colaborador_id = p_colaborador_id
      and m.aplica_a_partir_de <= p_data
    order by m.aplica_a_partir_de desc, m.data_medicao desc, m.created_at desc
    limit 1
  ), calculo as (
    select m.*,
      private.converter_saldo_minutos_em_dias(m.saldo_minutos, m.jornada_horas_dia) as saldo_dias,
      (select count(*)::integer from public.chamada_diaria cd
       where cd.colaborador_id = p_colaborador_id and cd.status = 'G'
         and cd.data >= m.aplica_a_partir_de and cd.data <= p_data) as dias_g_ciclo
    from medicao m
  )
  select c.id, c.data_medicao, c.aplica_a_partir_de, c.jornada_horas_dia,
         c.saldo_minutos, c.saldo_dias, c.dias_g_ciclo,
         case when c.saldo_dias > 0 then greatest(c.saldo_dias - c.dias_g_ciclo, 0)
              else 0 end as dias_pendentes_compensar,
         case when c.saldo_dias < 0 then -c.saldo_dias else 0 end as dias_repor
  from calculo c
$$;
revoke all on function private.banco_horas_no_dia(uuid,date) from public, anon, authenticated;

-- Preserve the public Daily Call contract and its operational population.
-- Its measured balance and G-adjusted days now come from the same private
-- calculation consumed by Banco de Horas.
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
    where cd.colaborador_id = c.id and cd.data between p_inicio and p_fim
  ) ch on true
  where v_role <> 'GESTOR' or (v_manager is not null and c.gestor_id = v_manager);
  return v_resultado;
end;
$$;
revoke all on function chamada_privada.ler_chamada_diaria_impl(date,date,date)
  from public, anon, authenticated;
grant execute on function chamada_privada.ler_chamada_diaria_impl(date,date,date)
  to authenticated;

create function chamada_privada.ler_banco_horas_atual_impl(p_data date)
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
  if p_data is null then
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
revoke all on function chamada_privada.ler_banco_horas_atual_impl(date)
  from public, anon, authenticated;
grant execute on function chamada_privada.ler_banco_horas_atual_impl(date)
  to authenticated;

create function public.ler_banco_horas_atual(p_data date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select chamada_privada.ler_banco_horas_atual_impl(p_data)
$$;
revoke all on function public.ler_banco_horas_atual(date) from public, anon, authenticated;
grant execute on function public.ler_banco_horas_atual(date) to authenticated;
