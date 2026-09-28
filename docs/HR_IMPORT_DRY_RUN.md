# Dry-run de importação RH

Este relatório contém somente agregados. A base operacional é o XLSX bruto; o tratado é referência opcional. Nenhuma escrita remota foi executada. A completude e atualidade do export exigem confirmação de proveniência além do parsing.

## Fonte bruta

- Abas: Quadro, Banco de horas, Férias, Metodologia, Gerente | Gestor.
- Data de referência resolvida: 2026-09-28; origem: EXPLICIT. A data do golden master e timestamps do filesystem nunca são usados como data da fonte.
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

- Linhas válidas: 356; positivas: 183; zero: 35; negativas nesta amostra: 138.
- Faixa de saldo: -12704 a 24703 minutos.
- O parser aceita sinais positivos, zero e negativos. A ausência de negativos isoladamente não demonstra filtragem; a presença deles isoladamente não comprova completude do export.
- Modo histórico: BASELINE. Movimentos: {}. Na primeira carga ninguém é marcado automaticamente como novo admitido.

## Golden master opcional

- Referência não fornecida. O fluxo operacional continua independente dela.

## Validação e decisão

- BLOCKERS: 0; WARNINGS: 50; INFO: 67.

| Código | Ocorrências |
| --- | ---: |
| BANK_NAME_CONFLICT | 1 |
| MANAGER_UNIT_CONFLICT | 9 |
| MANAGER_WITHOUT_QUADRO | 1 |
| MISSING_MANAGER | 26 |
| NO_BANK_EXTRACT | 28 |
| NUMERIC_SOURCE_MATRICULA | 1 |
| VACATION_NAME_CONFLICT | 1 |
| VACATION_WITHOUT_QUADRO | 50 |

- Escritas remotas: **0**. Dry-run não instancia cliente administrativo nem executa INSERT/UPDATE/UPSERT/DELETE.
- Política: gestor ausente e sem extrato são WARNING; matrícula duplicada, unidade principal desconhecida, saldo necessário inválido, identidade ambígua e data sem fonte confiável/sem --reference-date são BLOCKER.
- O dry-run acima não executou `--apply`. A aplicação e a auditoria posteriores da baseline constam em `HR_BASELINE_IMPORT.md`.
