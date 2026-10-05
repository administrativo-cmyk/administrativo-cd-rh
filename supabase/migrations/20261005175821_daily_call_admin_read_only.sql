-- Etapa 5C: one narrowly scoped, read-only Data API entry point.
-- The operational tables and existing security-invoker views keep their grants closed.
create function public.ler_chamada_diaria(
  p_data date,
  p_inicio date,
  p_fim date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_resultado jsonb;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.perfis p
    where p.id = (select auth.uid())
      and p.status_usuario = 'APROVADO'
      and p.papel_usuario = 'ADMIN'
  ) then
    raise exception using errcode = '42501', message = 'Acesso não autorizado à chamada diária';
  end if;

  if p_data is null or p_inicio is null or p_fim is null
     or p_fim < p_inicio or p_fim - p_inicio > 30 then
    raise exception using errcode = '22023', message = 'Intervalo de datas inválido';
  end if;

  select jsonb_build_object(
    'date', p_data,
    'startDate', p_inicio,
    'endDate', p_fim,
    'employees', coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'employeeNumber', c.matricula,
      'name', c.nome,
      'unit', c.unidade_codigo,
      'department', c.setor,
      'role', c.funcao,
      'situation', c.situacao,
      'manager', c.gestor_nome,
      'admissionDate', c.admissao,
      'measurementDate', m.data_medicao,
      'effectiveFrom', m.aplica_a_partir_de,
      'workdayHours', m.jornada_horas_dia,
      'balanceMinutes', m.saldo_minutos,
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
    where med.colaborador_id = c.id
      and med.aplica_a_partir_de <= p_data
    order by med.aplica_a_partir_de desc, med.data_medicao desc, med.created_at desc
    limit 1
  ) m on true
  left join lateral (
    select count(*)::integer as dias_g
    from public.chamada_diaria cd
    where cd.colaborador_id = c.id
      and cd.status = 'G'
      and cd.data >= m.aplica_a_partir_de
      and cd.data <= p_data
  ) g on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'date', cd.data, 'status', cd.status, 'observation', cd.observacao
    ) order by cd.data) as registros
    from public.chamada_diaria cd
    where cd.colaborador_id = c.id
      and cd.data between p_inicio and p_fim
  ) ch on true;

  return v_resultado;
end;
$$;

revoke all on function public.ler_chamada_diaria(date, date, date) from public, anon, authenticated;
grant execute on function public.ler_chamada_diaria(date, date, date) to authenticated;
