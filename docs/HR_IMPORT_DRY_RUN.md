# Dry-run de importação RH - Etapa 5A.1

Este relatório contém somente agregados. A base operacional é o XLSX bruto; o tratado é referência opcional. Nenhuma escrita remota foi executada. O arquivo bruto atual é uma amostra histórica parcialmente tratada e não serve para a primeira carga real.

## Fonte bruta

- Abas: Quadro, Banco de horas, Férias, Metodologia, Gerente | Gestor.
- Data de referência resolvida: não informada; origem: nenhuma. A data do golden master e timestamps do filesystem nunca são usados como data da fonte.
- Quadro: 384 linhas; Banco de horas: 356; Férias: 372; Gerente | Gestor: 359.
- População normalizada: 384; mensurados: 367; fora da mensuração: 17.

| Unidade | Colaboradores |
| --- | ---: |
| CD FLV | 133 |
| CD I | 208 |
| CD II | 43 |

| Situação normalizada | Colaboradores |
| --- | ---: |
| ACIDENTE_TRABALHO | 2 |
| AFASTADO | 11 |
| ATIVO | 354 |
| AVISO_PREVIO | 1 |
| FERIAS | 13 |
| LICENCA_MATERNIDADE | 1 |
| OUTRO_AFASTAMENTO | 2 |

## Cruzamentos

- Gestores únicos: 32; colaboradores com gestor: 358; sem gestor: 26, dos quais 9 mensurados. Todos permanecem no plano com vínculo pendente e agrupamento "Sem gestor definido".
- Linhas de gestor sem Quadro: 1; conflitos de unidade Quadro × gestor: 9.
- Quadro ∩ Banco: 356; somente Quadro: 28; somente Banco: 0.
- Mensurados sem extrato no lote: 12. Esses casos **não** são saldo zero.
- Conflitos de nome Quadro × Banco: 1; conflitos de unidade: 0.
- Quadro ∩ Férias: 322; somente Quadro: 62; somente Férias: 50; conflitos de nome: 1.

## Banco de horas e histórico

- Linhas válidas: 356; positivas: 204; zero: 152; negativas nesta amostra: 0.
- Faixa de saldo: 0 a 24703 minutos.
- O arquivo histórico atual teve colaboradores com saldo negativo removidos manualmente antes da análise. Esta ausência é informativa, **não é blocker**. O parser aceita sinais positivos, zero e negativos.
- Modo histórico: BASELINE. Movimentos: {}. Na primeira carga ninguém é marcado automaticamente como novo admitido.

## Golden master opcional

- Abas: Dashboard, Banco de Horas, Quadro Atual, Sugestão de Férias, Férias por Gestor e Mês, Chamada Diária, Top 20, Top por Gestor, Afastados e Outros, Sem Extrato 13-09, Metodologia.
- Snapshot do tratado: 2026-09-13; Quadro Atual: 376; Banco de Horas: 376.
- Quadro em comum: 357; divergências de unidade: 11; situação: 0; gestor: 166; jornada: 1.
- No Banco tratado atual: 224 positivos, 11 zeros e 141 negativos.
- Decimal × HH:MM no tratado: 376 comparações, 0 divergências acima de 1 minuto.
- Saldo atual exatamente igual em 13/354 linhas comparáveis. **Não interpretar diferenças individuais como erro**, pois a data da fonte bruta não é comprovada e a amostra foi filtrada.

## Validação e decisão

- BLOCKERS: 1; WARNINGS: 51; INFO: 68.

| Código | Ocorrências |
| --- | ---: |
| BANK_NAME_CONFLICT | 1 |
| DATA_REFERENCIA_NAO_INFORMADA | 1 |
| HISTORICAL_NEGATIVES_MANUALLY_REMOVED | 1 |
| MANAGER_UNIT_CONFLICT | 9 |
| MANAGER_WITHOUT_QUADRO | 1 |
| MISSING_MANAGER | 26 |
| NO_BANK_EXTRACT | 28 |
| NUMERIC_SOURCE_MATRICULA | 1 |
| SOURCE_GOLDEN_SNAPSHOT_NOT_COMPARABLE | 1 |
| VACATION_NAME_CONFLICT | 1 |
| VACATION_WITHOUT_QUADRO | 50 |

- Escritas remotas: **0**. Dry-run não instancia cliente administrativo nem executa INSERT/UPDATE/UPSERT/DELETE.
- Política: gestor ausente e sem extrato são WARNING; matrícula duplicada, unidade principal desconhecida, saldo necessário inválido, identidade ambígua e data sem fonte confiável/sem --reference-date são BLOCKER.
- Primeira carga real: requer um novo export atual, completo, sem filtros ou tratamento manual, novo dry-run e autorização explícita. Este relatório histórico não libera --apply nem a Etapa 5B.
