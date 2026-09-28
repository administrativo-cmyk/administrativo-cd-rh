# Baseline inicial de RH — 2026-09-28

## Proveniência e destino

- Fonte operacional exclusiva: `Banco de dados RH.xlsx`, mantida em `data/private/`.
- SHA-256 homologado e recalculado: `D9C64510B904D89959957EC6A6CA80E454C08CC591F18A36C143E0AE16CE7D17`.
- Projeto: organização Administrativo CD, `administrativo-cd-rh`, ref `kqgtnucqxqqgwdyvhvdd`, região `sa-east-1`.
- Data de referência, medição e `aplica_a_partir_de`: `2026-09-28`.
- Tipo lógico: `BASELINE_RH`; tipo do schema: `EXCEL`.
- Lote concluído: `a0721e3b-c91f-4c89-9e79-a8e50fa372ad`. O lote registra o hash, timestamps, 740 registros processados, zero erros e warnings agregados; não guarda o XLSX nem caminho local.

## Pré-carga e homologação

Antes da escrita: 1 Auth user, 1 perfil ADMIN aprovado, 3 unidades, 0 gestores, 0 colaboradores, 0 lotes, 0 medições e 0 chamadas. As 10 migrations anteriores estavam sincronizadas. `typecheck`, lint, 123 testes e build passaram. O dry-run final retornou 0 blockers, 50 warnings e 67 infos, com 384 linhas de Quadro e 356 de Banco: 183 saldos positivos, 35 zero e 138 negativos.

## Aplicação e atomicidade

A migration `20260928192834_baseline_import_provenance.sql` adicionou metadados e índice único do lote, além da função administrativa `private.aplicar_baseline_rh`. Local e remoto ficaram com 11 migrations. A função recebe o mesmo plano do parser/dry-run, reutiliza as três unidades existentes e executa lote, gestores, colaboradores e medições numa única chamada transacional PostgreSQL. Ela valida pré-condições e todos os totais críticos antes de retornar; qualquer erro reverte a chamada inteira. `anon`, `authenticated` e `service_role` não têm `EXECUTE` nela. Nenhuma policy operacional foi relaxada.

O rollback foi testado com dados fictícios: uma medição final inválida reverteu lote, gestores, colaboradores e medições para zero. Uma aplicação fictícia válida produziu as contagens esperadas e a repetição foi recusada. No projeto oficial, a segunda tentativa retornou `BASELINE_ALREADY_APPLIED`; a consulta posterior confirmou 1 lote, 32 gestores, 384 colaboradores e 356 medições, sem duplicação.

## Auditoria direta após a carga

| Indicador | Resultado |
| --- | ---: |
| Auth users / perfis / ADMIN aprovado | 1 / 1 / 1 |
| Unidades reutilizadas | 3 |
| Gestores | 32 |
| Colaboradores / matrículas distintas | 384 / 384 |
| Colaboradores sem gestor / mensurados sem gestor | 26 / 9 |
| População mensurada pela view real | 367 |
| Medições da baseline | 356 |
| Saldos positivos / zero / negativos | 183 / 35 / 138 |
| Sem extrato / mensurados sem extrato | 28 / 12 |
| Lotes `BASELINE_RH` concluídos | 1 |
| Chamadas reais | 0 |

Jornadas persistidas, em minutos por dia: 240 (3 pessoas), 360 (10), 440 (339), 720 (32). Todas as medições têm data e início de aplicação em `2026-09-28`. Não há medição sem colaborador ou lote, colaborador sem unidade ou lote, nem FK de gestor quebrada. As 28 ausências de extrato não foram convertidas em saldo zero. O plano permaneceu baseline inicial, sem inferir admissões novas ou histórico anterior.

## Warnings e limites

O lote preserva 50 warnings agregados. Incluem 26 colaboradores sem gestor, 12 mensurados sem extrato, 9 conflitos de unidade na fonte secundária de gestores, 2 conflitos de nome entre fontes secundárias e Quadro, e 1 linha órfã na associação de gestores. Não houve correção manual dessas ocorrências. A aba Férias não foi aplicada.

Os Advisors de segurança/performance não apontaram regressão da migration. Permaneceu um aviso externo de configuração de proteção de senhas vazadas no Auth, fora desta etapa. Auth e perfis não foram alterados; Chamada Diária continua com dados mockados no frontend. Nexsys, `supabase-almond-village`, Vercel e `main` não foram usados ou alterados nesta carga.
