alter table public.lotes_importacao
  add column source_hash text,
  add column started_at timestamptz,
  add column completed_at timestamptz,
  add column warnings_agregados jsonb not null default '{}'::jsonb;

alter table public.lotes_importacao
  add constraint lotes_baseline_provenance_check check (
    fonte is distinct from 'BASELINE_RH'
    or (
      tipo = 'EXCEL'
      and nome_arquivo = 'Banco de dados RH.xlsx'
      and data_referencia is not null
      and source_hash ~ '^[0-9A-F]{64}$'
      and started_at is not null
      and completed_at is not null
      and jsonb_typeof(warnings_agregados) = 'object'
    )
  );

create unique index lotes_baseline_rh_data_unique
on public.lotes_importacao (data_referencia)
where fonte = 'BASELINE_RH' and status = 'CONCLUIDO';

create or replace function private.aplicar_baseline_rh(
  p_project_ref text,
  p_source_hash text,
  p_reference_date date,
  p_payload jsonb,
  p_warnings jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_lote_id uuid;
  v_item jsonb;
  v_manager text;
  v_unit_id uuid;
  v_manager_id uuid;
  v_employee_id uuid;
  v_counts record;
begin
  if p_project_ref is distinct from 'kqgtnucqxqqgwdyvhvdd'
    or p_reference_date is distinct from date '2026-09-28'
    or p_source_hash is distinct from 'D9C64510B904D89959957EC6A6CA80E454C08CC591F18A36C143E0AE16CE7D17' then
    raise exception 'BASELINE_PREFLIGHT_MISMATCH';
  end if;
  if jsonb_typeof(p_payload->'employees') is distinct from 'array'
    or jsonb_typeof(p_payload->'bank') is distinct from 'array'
    or jsonb_array_length(p_payload->'employees') <> 384
    or jsonb_array_length(p_payload->'bank') <> 356
    or jsonb_typeof(p_warnings) is distinct from 'object' then
    raise exception 'BASELINE_PLAN_INVALID';
  end if;

  -- The unique index is the final concurrent-apply guard; this check gives a clear retry result.
  if exists (select 1 from public.lotes_importacao
             where fonte = 'BASELINE_RH' and data_referencia = p_reference_date and status = 'CONCLUIDO') then
    raise exception 'BASELINE_ALREADY_APPLIED';
  end if;
  if (select count(*) from public.unidades where codigo in ('CD I', 'CD II', 'CD FLV')) <> 3
    or (select count(*) from public.unidades) <> 3
    or (select count(*) from public.gestores) <> 0
    or (select count(*) from public.colaboradores) <> 0
    or (select count(*) from public.banco_horas_medicoes) <> 0
    or (select count(*) from public.lotes_importacao) <> 0
    or (select count(*) from public.chamada_diaria) <> 0
    or (select count(*) from auth.users) <> 1
    or (select count(*) from public.perfis where status_usuario = 'APROVADO' and papel_usuario = 'ADMIN') <> 1 then
    raise exception 'BASELINE_REMOTE_STATE_CHANGED';
  end if;

  insert into public.lotes_importacao (
    tipo, fonte, nome_arquivo, data_referencia, status, registros_processados,
    registros_com_erro, source_hash, started_at, completed_at, warnings_agregados
  ) values (
    'EXCEL', 'BASELINE_RH', 'Banco de dados RH.xlsx', p_reference_date, 'CONCLUIDO',
    740, 0, p_source_hash, now(), now(), p_warnings
  ) returning id into v_lote_id;

  for v_manager in
    select distinct item->>'gestor'
    from jsonb_array_elements(p_payload->'employees') as item
    where nullif(item->>'gestor', '') is not null
  loop
    insert into public.gestores (nome) values (v_manager);
  end loop;

  for v_item in select value from jsonb_array_elements(p_payload->'employees') loop
    select id into v_unit_id from public.unidades where codigo = v_item->>'unidade';
    if v_unit_id is null then raise exception 'BASELINE_UNKNOWN_UNIT'; end if;
    v_manager_id := null;
    if nullif(v_item->>'gestor', '') is not null then
      select id into v_manager_id from public.gestores where nome = v_item->>'gestor';
      if v_manager_id is null then raise exception 'BASELINE_UNKNOWN_MANAGER'; end if;
    end if;
    insert into public.colaboradores (
      matricula, nome, unidade_id, gestor_id, setor, funcao, situacao, admissao,
      jornada_horas_dia_atual, ativo_no_sistema, ultimo_lote_importacao_id
    ) values (
      v_item->>'matricula', v_item->>'nome', v_unit_id, v_manager_id,
      v_item->>'setor', v_item->>'funcao', (v_item->>'situacao')::public.situacao_colaborador,
      (v_item->>'admissao')::date, ((v_item->>'jornadaMinutos')::integer / 60.0),
      true, v_lote_id
    );
  end loop;

  for v_item in select value from jsonb_array_elements(p_payload->'bank') loop
    select id into v_employee_id from public.colaboradores where matricula = v_item->>'matricula';
    if v_employee_id is null then raise exception 'BASELINE_BANK_WITHOUT_EMPLOYEE'; end if;
    insert into public.banco_horas_medicoes (
      colaborador_id, data_medicao, aplica_a_partir_de, jornada_horas_dia,
      saldo_minutos, origem, lote_importacao_id
    ) select
      v_employee_id, p_reference_date, p_reference_date, c.jornada_horas_dia_atual,
      (v_item->>'saldoMinutos')::integer, 'BASELINE_RH', v_lote_id
    from public.colaboradores c where c.id = v_employee_id;
  end loop;

  select
    (select count(*) from public.gestores) as managers,
    (select count(*) from public.colaboradores) as employees,
    (select count(*) from public.banco_horas_medicoes where lote_importacao_id = v_lote_id) as measurements,
    (select count(*) from public.banco_horas_medicoes where lote_importacao_id = v_lote_id and saldo_minutos > 0) as positive,
    (select count(*) from public.banco_horas_medicoes where lote_importacao_id = v_lote_id and saldo_minutos = 0) as zero,
    (select count(*) from public.banco_horas_medicoes where lote_importacao_id = v_lote_id and saldo_minutos < 0) as negative,
    (select count(*) from public.colaboradores where gestor_id is null) as without_manager,
    (select count(*) from public.vw_colaboradores_mensurados where gestor_id is null) as measured_without_manager,
    (select count(*) from public.vw_colaboradores_mensurados) as measured,
    (select count(*) from public.colaboradores c where not exists
      (select 1 from public.banco_horas_medicoes m where m.colaborador_id = c.id and m.lote_importacao_id = v_lote_id)) as without_extract,
    (select count(*) from public.vw_colaboradores_mensurados c where not exists
      (select 1 from public.banco_horas_medicoes m where m.colaborador_id = c.id and m.lote_importacao_id = v_lote_id)) as measured_without_extract
  into v_counts;

  if v_counts.managers <> 32 or v_counts.employees <> 384 or v_counts.measurements <> 356
    or v_counts.positive <> 183 or v_counts.zero <> 35 or v_counts.negative <> 138
    or v_counts.without_manager <> 26 or v_counts.measured_without_manager <> 9
    or v_counts.measured <> 367 or v_counts.without_extract <> 28
    or v_counts.measured_without_extract <> 12 then
    raise exception 'BASELINE_POSTCONDITION_FAILED';
  end if;

  return jsonb_build_object('lote_id', v_lote_id, 'gestores', v_counts.managers,
    'colaboradores', v_counts.employees, 'medicoes', v_counts.measurements);
end;
$$;

revoke all on function private.aplicar_baseline_rh(text, text, date, jsonb, jsonb)
from public, anon, authenticated, service_role;
