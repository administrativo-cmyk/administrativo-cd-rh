-- Etapa 5D: no seed or operational data migration.
create table public.chamada_diaria_auditoria (
  id uuid primary key default gen_random_uuid(),
  chamada_id uuid not null,
  colaborador_id uuid not null references public.colaboradores(id) on delete restrict,
  data date not null,
  status_anterior public.codigo_chamada,
  status_novo public.codigo_chamada,
  observacao_anterior text,
  observacao_nova text,
  operacao text not null check (operacao in ('INSERT', 'UPDATE', 'CLEAR')),
  alterado_por uuid not null,
  alterado_em timestamptz not null default clock_timestamp()
);
create index chamada_diaria_auditoria_colaborador_data_idx
  on public.chamada_diaria_auditoria (colaborador_id, data, alterado_em desc);
alter table public.chamada_diaria_auditoria enable row level security;
revoke all on table public.chamada_diaria_auditoria from public, anon, authenticated;

create function private.definir_chamada_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
revoke all on function private.definir_chamada_updated_at() from public, anon, authenticated;
drop trigger chamada_diaria_definir_updated_at on public.chamada_diaria;
create trigger chamada_diaria_definir_updated_at
before update on public.chamada_diaria
for each row execute function private.definir_chamada_updated_at();

create function public.salvar_chamada_diaria(
  p_colaborador_id uuid, p_data date, p_status public.codigo_chamada,
  p_observacao text, p_expected_updated_at timestamptz
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_observacao text := nullif(btrim(p_observacao), '');
  v_existing public.chamada_diaria%rowtype;
  v_saved public.chamada_diaria%rowtype;
begin
  if v_actor is null or not exists (
    select 1 from public.perfis p
    where p.id = v_actor and p.status_usuario = 'APROVADO' and p.papel_usuario = 'ADMIN'
  ) then
    raise exception using errcode = '42501', message = 'Acesso não autorizado à Chamada Diária.';
  end if;
  if p_colaborador_id is null or p_data is null then
    raise exception using errcode = '22023', message = 'Colaborador e data são obrigatórios.';
  end if;
  if not exists (select 1 from public.vw_colaboradores_mensurados c where c.id = p_colaborador_id) then
    raise exception using errcode = '22023', message = 'Colaborador fora da população operacional.';
  end if;
  if length(v_observacao) > 500 then
    raise exception using errcode = '22023', message = 'A observação deve ter no máximo 500 caracteres.';
  end if;
  if p_status is null and v_observacao is not null then
    raise exception using errcode = '22023', message = 'Selecione um status antes de adicionar observação.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_colaborador_id::text), pg_catalog.hashtext(p_data::text)
  );
  select * into v_existing from public.chamada_diaria
  where colaborador_id = p_colaborador_id and data = p_data for update;

  if v_existing.id is null then
    if p_expected_updated_at is not null then
      raise exception using errcode = 'PT409', message = 'Este lançamento foi alterado por outro usuário. Atualize os dados e tente novamente.';
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
      raise exception using errcode = 'PT409', message = 'Este lançamento foi alterado por outro usuário. Atualize os dados e tente novamente.';
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
revoke all on function public.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.salvar_chamada_diaria(uuid,date,public.codigo_chamada,text,timestamptz)
  to authenticated;

-- Preserve the 5C read contract and append a version per attendance cell.
create or replace function public.ler_chamada_diaria(p_data date, p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_resultado jsonb;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.perfis p where p.id = (select auth.uid())
      and p.status_usuario = 'APROVADO' and p.papel_usuario = 'ADMIN'
  ) then
    raise exception using errcode = '42501', message = 'Acesso não autorizado à chamada diária';
  end if;
  if p_data is null or p_inicio is null or p_fim is null
     or p_fim < p_inicio or p_fim - p_inicio > 30 then
    raise exception using errcode = '22023', message = 'Intervalo de datas inválido';
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
  ) ch on true;
  return v_resultado;
end;
$$;
revoke all on function public.ler_chamada_diaria(date,date,date) from public, anon, authenticated;
grant execute on function public.ler_chamada_diaria(date,date,date) to authenticated;
