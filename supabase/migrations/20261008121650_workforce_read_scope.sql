-- Etapa 6A: complete registered workforce, independently of the operational call.
-- The exposed entry point is invoker-only; the private helper enforces role scope.
create function private.ler_quadro_atual_impl()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.papel_usuario;
  v_manager uuid;
  v_result jsonb;
begin
  select p.papel_usuario, p.gestor_id into v_role, v_manager
  from public.perfis p
  where p.id = v_actor and p.status_usuario = 'APROVADO';

  if v_actor is null or not found or v_role not in ('ADMIN', 'RH', 'GESTOR', 'LEITURA') then
    raise exception using errcode = '42501', message = 'Acesso nao autorizado ao Quadro Atual.';
  end if;

  select pg_catalog.jsonb_build_object(
    'employees', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', c.id,
      'employeeNumber', c.matricula,
      'name', c.nome,
      'unit', u.codigo,
      'manager', g.nome,
      'managerId', c.gestor_id,
      'department', c.setor,
      'role', c.funcao,
      'situation', c.situacao,
      'category', c.categoria,
      'admissionDate', c.admissao,
      'workdayHours', c.jornada_horas_dia_atual,
      'activeInSystem', c.ativo_no_sistema,
      'bankMeasurementDate', m.data_medicao,
      'bankBalanceMinutes', m.saldo_minutos,
      'bankBalanceDays', case when m.id is null then null
        else private.converter_saldo_minutos_em_dias(m.saldo_minutos, m.jornada_horas_dia) end
    ) order by c.nome, c.matricula), '[]'::jsonb)
  ) into v_result
  from public.colaboradores c
  join public.unidades u on u.id = c.unidade_id
  left join public.gestores g on g.id = c.gestor_id
  left join lateral (
    select med.id, med.data_medicao, med.jornada_horas_dia, med.saldo_minutos
    from public.banco_horas_medicoes med
    where med.colaborador_id = c.id and med.aplica_a_partir_de <= current_date
    order by med.aplica_a_partir_de desc, med.data_medicao desc, med.created_at desc
    limit 1
  ) m on true
  where v_role <> 'GESTOR' or (v_manager is not null and c.gestor_id = v_manager);

  return v_result;
end;
$$;
revoke all on function private.ler_quadro_atual_impl() from public, anon, authenticated;
grant execute on function private.ler_quadro_atual_impl() to authenticated;

create function public.ler_quadro_atual()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.ler_quadro_atual_impl()
$$;
revoke all on function public.ler_quadro_atual() from public, anon, authenticated;
grant execute on function public.ler_quadro_atual() to authenticated;
