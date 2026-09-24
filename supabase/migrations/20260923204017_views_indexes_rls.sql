create index gestores_unidade_referencia_id_idx
on public.gestores (unidade_referencia_id)
where unidade_referencia_id is not null;

create index colaboradores_unidade_id_idx on public.colaboradores (unidade_id);
create index colaboradores_gestor_id_idx on public.colaboradores (gestor_id) where gestor_id is not null;
create index colaboradores_situacao_ativo_idx on public.colaboradores (situacao) where ativo_no_sistema;
create index colaboradores_ultimo_lote_importacao_id_idx on public.colaboradores (ultimo_lote_importacao_id) where ultimo_lote_importacao_id is not null;
create index lotes_importacao_status_data_idx on public.lotes_importacao (status, data_referencia desc);
create index lotes_importacao_created_by_idx on public.lotes_importacao (created_by) where created_by is not null;

create index banco_horas_medicoes_colaborador_baseline_idx
on public.banco_horas_medicoes (colaborador_id, aplica_a_partir_de desc, data_medicao desc);

create index banco_horas_medicoes_data_medicao_idx
on public.banco_horas_medicoes (data_medicao desc);

create index banco_horas_medicoes_lote_importacao_id_idx
on public.banco_horas_medicoes (lote_importacao_id)
where lote_importacao_id is not null;

create index chamada_diaria_data_status_idx on public.chamada_diaria (data, status);
create index chamada_diaria_created_by_idx on public.chamada_diaria (created_by) where created_by is not null;
create index chamada_diaria_updated_by_idx on public.chamada_diaria (updated_by) where updated_by is not null;

create view public.vw_colaboradores_mensurados
with (security_invoker = true)
as
select
  c.id,
  c.matricula,
  c.nome,
  c.unidade_id,
  u.codigo as unidade_codigo,
  u.nome as unidade_nome,
  c.gestor_id,
  g.nome as gestor_nome,
  c.setor,
  c.funcao,
  c.situacao,
  c.categoria,
  c.admissao,
  c.movimento,
  c.jornada_horas_dia_atual,
  c.observacao,
  c.created_at,
  c.updated_at
from public.colaboradores c
join public.unidades u on u.id = c.unidade_id
left join public.gestores g on g.id = c.gestor_id
where c.ativo_no_sistema
  and c.situacao in ('ATIVO', 'FERIAS', 'NOVO_ADMITIDO');

create view public.vw_banco_horas_ciclos
with (security_invoker = true)
as
with ciclos as (
  select
    m.*,
    lead(m.aplica_a_partir_de) over (
      partition by m.colaborador_id
      order by m.aplica_a_partir_de, m.data_medicao, m.created_at
    ) as proxima_baseline
  from public.banco_horas_medicoes m
), calculados as (
  select
    c.*,
    private.converter_saldo_minutos_em_dias(c.saldo_minutos, c.jornada_horas_dia) as saldo_dias,
    count(cd.id) filter (where cd.status = 'G')::integer as dias_g_ciclo
  from ciclos c
  left join public.chamada_diaria cd
    on cd.colaborador_id = c.colaborador_id
   and cd.data >= c.aplica_a_partir_de
   and (c.proxima_baseline is null or cd.data < c.proxima_baseline)
  group by
    c.id,
    c.colaborador_id,
    c.data_medicao,
    c.aplica_a_partir_de,
    c.jornada_horas_dia,
    c.saldo_minutos,
    c.origem,
    c.lote_importacao_id,
    c.created_at,
    c.proxima_baseline
)
select
  calculados.*,
  case
    when saldo_dias > 0 then greatest(saldo_dias - dias_g_ciclo, 0)
    else 0
  end as dias_pendentes_compensar,
  case when saldo_dias < 0 then abs(saldo_dias) else 0 end as dias_repor,
  case
    when saldo_dias < 0 then 'A_REPOR'
    when saldo_dias > 0 and greatest(saldo_dias - dias_g_ciclo, 0) > 0 then 'A_COMPENSAR'
    else 'EM_DIA'
  end as situacao_banco
from calculados;

create view public.vw_banco_horas_atual
with (security_invoker = true)
as
select distinct on (ciclo.colaborador_id)
  ciclo.*
from public.vw_banco_horas_ciclos ciclo
where ciclo.aplica_a_partir_de <= current_date
order by ciclo.colaborador_id, ciclo.aplica_a_partir_de desc, ciclo.data_medicao desc, ciclo.created_at desc;

create view public.vw_banco_horas_resumo
with (security_invoker = true)
as
select
  coalesce(sum(saldo_minutos) filter (where saldo_minutos > 0), 0)::bigint as total_minutos_positivos,
  coalesce(sum(saldo_minutos) filter (where saldo_minutos < 0), 0)::bigint as total_minutos_negativos,
  count(*) filter (where saldo_minutos > 0)::integer as quantidade_positiva,
  count(*) filter (where saldo_minutos < 0)::integer as quantidade_negativa
from public.vw_banco_horas_atual;

create view public.vw_chamada_diaria_contexto
with (security_invoker = true)
as
select
  cd.id,
  cd.colaborador_id,
  cd.data,
  cd.status,
  cd.observacao,
  cd.created_at,
  cd.updated_at,
  c.matricula,
  c.nome as colaborador_nome,
  u.codigo as unidade_codigo,
  g.nome as gestor_nome,
  c.situacao as colaborador_situacao
from public.chamada_diaria cd
join public.colaboradores c on c.id = cd.colaborador_id
join public.unidades u on u.id = c.unidade_id
left join public.gestores g on g.id = c.gestor_id;

alter table public.unidades enable row level security;
alter table public.gestores enable row level security;
alter table public.lotes_importacao enable row level security;
alter table public.colaboradores enable row level security;
alter table public.banco_horas_medicoes enable row level security;
alter table public.chamada_diaria enable row level security;

revoke all on table public.unidades from anon, authenticated;
revoke all on table public.gestores from anon, authenticated;
revoke all on table public.lotes_importacao from anon, authenticated;
revoke all on table public.colaboradores from anon, authenticated;
revoke all on table public.banco_horas_medicoes from anon, authenticated;
revoke all on table public.chamada_diaria from anon, authenticated;
revoke all on table public.vw_colaboradores_mensurados from anon, authenticated;
revoke all on table public.vw_banco_horas_ciclos from anon, authenticated;
revoke all on table public.vw_banco_horas_atual from anon, authenticated;
revoke all on table public.vw_banco_horas_resumo from anon, authenticated;
revoke all on table public.vw_chamada_diaria_contexto from anon, authenticated;
