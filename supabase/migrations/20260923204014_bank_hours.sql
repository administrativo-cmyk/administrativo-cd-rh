create table public.banco_horas_medicoes (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores(id) on delete restrict,
  data_medicao date not null,
  aplica_a_partir_de date not null,
  jornada_horas_dia numeric(6, 4) not null,
  saldo_minutos integer not null,
  origem text,
  lote_importacao_id uuid references public.lotes_importacao(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint banco_horas_medicoes_baseline_unique unique (colaborador_id, aplica_a_partir_de),
  constraint banco_horas_medicoes_jornada_valida check (jornada_horas_dia > 0 and jornada_horas_dia <= 24)
);

create or replace function private.converter_saldo_minutos_em_dias(
  p_saldo_minutos integer,
  p_jornada_horas numeric
)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_jornada_minutos integer;
  v_saldo_absoluto integer;
  v_dias integer;
  v_resto_minutos integer;
begin
  v_jornada_minutos := round(p_jornada_horas * 60)::integer;

  if v_jornada_minutos <= 0 then
    raise exception 'jornada_horas deve ser maior que zero';
  end if;

  v_saldo_absoluto := abs(p_saldo_minutos);
  v_dias := v_saldo_absoluto / v_jornada_minutos;
  v_resto_minutos := mod(v_saldo_absoluto, v_jornada_minutos);

  if v_resto_minutos > 300 then
    v_dias := v_dias + 1;
  end if;

  if p_saldo_minutos < 0 then
    return -v_dias;
  end if;

  return v_dias;
end;
$$;

revoke all on function private.converter_saldo_minutos_em_dias(integer, numeric) from public, anon, authenticated;
