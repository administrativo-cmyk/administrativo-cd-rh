# Relatório das Etapas 5A e 5A.1 — dry-run local

Todos os números abaixo são agregados. As planilhas e os relatórios por matrícula permanecem em `data/private/`. O dry-run da amostra histórica termina com código de bloqueio por faltar a data de referência: **1 BLOCKER, 51 WARNINGS, 68 INFOS**. Isso não significa falha de parsing. Nenhuma aplicação remota foi feita.

1. **Estrutura do bruto:** 5 abas: `Quadro` (384 linhas com chave), `Banco de horas` (356), `Férias` (372), `Metodologia` (texto) e `Gerente | Gestor` (359). Cabeçalhos e tipos estão no [mapeamento](RAW_TO_SYSTEM_MAPPING.md).
2. **Estrutura do tratado:** 11 abas: Dashboard, Banco de Horas, Quadro Atual, Sugestão de Férias, Férias por Gestor e Mês, Chamada Diária, Top 20, Top por Gestor, Afastados e Outros, Sem Extrato 13-09 e Metodologia.
3. **Snapshots:** o tratado declara 11/09/2026 como mensuração anterior e 13/09/2026 como atual. A data do bruto **não é comprovada**. Metadados de edição do arquivo e texto copiado da metodologia não são data confiável de extração.
4. **Quadro → Quadro Atual:** o bruto contém 384 pessoas; 367 em situação Ativo/Férias mensurável. O tratado contém 376 em outro período; 357 matrículas coincidem, 27 estão só no Quadro bruto e 19 só no Quadro Atual tratado.
5. **Gerente | Gestor → gestor operacional:** associação por `MATR.` = `Chapa`; não há coluna `GESTOR ATUAL` no bruto. O campo homônimo do Quadro Atual tratado está vazio nas 376 linhas, portanto a fonte operacional disponível é `GESTOR` da aba bruta.
6. **Cobertura de gestores:** 358/384 matrículas do Quadro têm linha de associação. Faltam 26, inclusive 9 mensurados; existe 1 linha de gestor sem Quadro. Há 9 conflitos de unidade Quadro × associação e nenhum conflito de nome nesse join.
7. **Banco bruto → tratado:** 356 matrículas do Banco bruto também estão no Quadro. O tratado tem 376 linhas e representa outra mensuração; em 354 matrículas com saldo nos dois arquivos, somente 13 saldos atuais são idênticos. Diferença individual não foi classificada como erro temporalmente comparável.
8. **Formato bruto do saldo:** 326 células Excel `hh:mm` e 30 `[hh]:mm:ss`; o leitor as expõe como data/duração. A conversão usa a época Excel do workbook e produz minutos inteiros, inclusive durações acima de 24 horas.
9. **Negativos ausentes:** o usuário informou que foram removidos manualmente desta amostra antiga. A planilha bruta efetivamente contém 0 negativos; a causa não é inferida dos bytes, mas registrada conforme a declaração do usuário. Não é blocker.
10. **Sinais suportados:** testes fictícios cobrem positivo, zero e negativo como fração de dia Excel e texto `HH:MM` assinado. O golden master contém 141 saldos atuais negativos.
11. **Limitação da amostra:** o bruto filtrado valida empiricamente positivos/zeros, não a cobertura real de negativos do export original. Um export completo, sem exclusões, será necessário antes de aplicação.
12. **Jornada:** padrão 7h20 (440 min); Apoio Prevenção e Perdas 12h (720); Aprendiz/PCD identificável 6h (360); Menor Aprendiz 4h (240). Um desacordo com o tratado ocorre porque a função da mesma matrícula mudou de Aprendiz para Menor Aprendiz entre períodos.
13. **Excel → minutos:** número de dia × 1440, arredondado ao minuto; `Date` de duração usa a época 1900/1904 do workbook. Exemplo testado: 0,5 dia = 720 minutos.
14. **HH:MM → minutos:** parser aceita `HH:MM`, `+HH:MM` e `-HH:MM`; `-07:17` = -437. No tratado, 376/376 pares decimal × HH:MM coincidiram com tolerância de 1 minuto.
15. **Minutos → dias:** reaproveita `convertHoursToDays`; dias inteiros pela jornada, adicionando um apenas se o resto exceder 300 minutos. Resto igual a 300 não acrescenta; sinal negativo é preservado.
16. **Sem extrato:** 28 pessoas do Quadro não têm linha no Banco bruto, incluindo 12 mensurados. O modelo não substitui ausência por saldo zero. Há 152 saldos zero verdadeiros entre as 356 linhas presentes.
17. **Histórico Supabase futuro:** a primeira carga é baseline; a partir da seguinte, consultar a última medição, comparar e criar nova baseline por colaborador e data efetiva. Nada disso foi escrito remotamente nesta etapa.
18. **Novos admitidos:** detectados por matrícula presente no snapshot novo e ausente no anterior. Na primeira carga, ninguém recebe essa marca automaticamente.
19. **Movimentações:** a comparação local está preparada para admissão, não encontrado no lote seguinte, mudança de gestor, unidade, setor, função e situação; ausência não aciona exclusão.
20. **Férias:** 372 linhas brutas com período aquisitivo, avos e datas de elegibilidade. O motor de Sugestão de Férias não foi implementado nesta etapa.
21. **Módulos sem Excel intermediário no desenho futuro:** Quadro Atual, Banco de Horas, Chamada Diária, Top 20, Top por Gestor, Afastados e Outros, Dashboard e visões de Férias serão consultas/regras derivadas; o golden master nunca é entrada operacional obrigatória.
22. **Registros do Quadro bruto:** 384.
23. **Matrículas únicas:** 384/384; sem duplicidade observada. Todas as células de matrícula da amostra são números Excel `General`, convertidos em string; um zero à esquerda já perdido na origem numérica não pode ser adivinhado.
24. **Unidades:** CD I 208, CD FLV 133 e CD II 43.
25. **Gestores únicos:** 32 nomes normalizados na aba bruta; 10 gerentes distintos. Nomes não foram publicados neste relatório.
26. **Colaboradores com gestor:** 358.
27. **Colaboradores sem gestor:** 26, dos quais 9 mensurados.
28. **Registros do Banco bruto:** 356.
29. **Positivos presentes:** 204.
30. **Zeros presentes:** 152.
31. **Negativos nesta amostra:** 0; classificação `INFO`, não `BLOCKER`.
32. **Cobertura de Férias:** 322 matrículas em Quadro + Férias; 62 só Quadro; 50 só Férias. Essas 50 podem refletir histórico e não são apagadas.
33. **Quadro + Banco:** 356.
34. **Somente Quadro:** 28.
35. **Somente Banco:** 0.
36. **Duplicidades:** 0 nas chaves auditadas das quatro abas brutas.
37. **Conflitos:** 9 de unidade Quadro × Gestor; 1 de nome Quadro × Banco; 1 de nome Quadro × Férias; 0 de unidade Quadro × Banco. Contra o tratado de outro período: 11 de unidade, 166 de gestor, 1 de jornada e 0 de situação entre linhas coincidentes.
38. **BLOCKERS:** 1 = `DATA_REFERENCIA_NAO_INFORMADA`. A fonte bruta não comprova a data e nenhum `--reference-date` foi informado.
39. **WARNINGS:** 51, incluindo 26 sem gestor (9 mensurados), 12 mensurados sem extrato, 9 conflitos de unidade com gestor, 1 linha de gestor órfã, 1 conflito de nome no Banco, 1 em Férias e 1 aviso de comparação temporal. Contagens por código no [dry-run](HR_IMPORT_DRY_RUN.md).
40. **INFO:** 68 ocorrências, incluindo 16 sem extrato de não mensurados e 50 linhas históricas de Férias fora do Quadro; a remoção manual dos negativos é informação, não blocker.
41. **Arquivos privados gerados:** os dois XLSX originais; `hr-analysis-private.json`, `workbook-audit-private.json`, `hr-import-details.json`, `hr-import-errors.csv`, `hr-import-current-snapshot.json` e scripts auxiliares de auditoria, todos sob `data/private/` e ignorados.
42. **Relatórios versionáveis:** `HR_IMPORT_ARCHITECTURE.md`, `RAW_TO_SYSTEM_MAPPING.md`, `HR_IMPORT_DRY_RUN.md` e este relatório; só esquema e agregados.
43. **PII em arquivos versionáveis:** o plano detalhado e o CSV com matrículas ficam em `data/private/`. A varredura dos 14 arquivos versionáveis alterados/novos encontrou **0 correspondências** com nomes ou matrículas reais. O staging foi inspecionado separadamente antes do commit.
44. **Comando:** `pnpm hr:import:dry --source "data/private/Banco de dados RH.xlsx" --reference "data/private/Banco de horas.xlsx"`. A referência é opcional. `--apply` é recusado.
45. **Escritas remotas:** 0 no código e na execução do dry-run; não há import de cliente Supabase no processo. Não se executou migration ou SQL de escrita.
46. **Auth users finais:** não confirmados por leitura remota nesta tarefa. O conector Supabase disponível listou apenas um projeto de outra organização; por segurança, não foi usado para consultar ou alterar o projeto oficial.
47. **Perfis finais:** não confirmados pelo mesmo motivo. Nenhum fluxo Auth foi chamado.
48. **Colaboradores remotos finais:** não confirmados por leitura; o importador não gravou colaboradores.
49. **Medições/chamadas remotas finais:** não confirmadas por leitura; o importador não gravou medições ou chamadas.
50. **Testes:** os 36 testes iniciais foram ampliados com cenários de gestor pendente, data explícita, precedência de metadado, data inválida, timestamp ignorado e sem extrato distinto de zero.
51. **Total de testes:** 123 em 13 arquivos (baseline anterior: 83 em 11 arquivos).
52. **Resultado dos testes:** 123/123 passaram.
53. **TypeScript:** `pnpm typecheck` passou.
54. **Lint:** `pnpm lint` passou.
55. **Build:** `pnpm build` passou.
56. **Documentação criada:** arquitetura, mapeamento real, resumo agregado do dry-run e este relatório.
57. **Arquivos criados:** `.gitkeep` em `data/private/`; quatro documentos; `lib/hr-import/normalize.ts`, `workbook.ts`, `pipeline.ts`, dois testes; `scripts/import-hr-data.ts`.
58. **Arquivos alterados:** `.gitignore`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`. Nenhum módulo da Chamada Diária ou Auth foi alterado.
59. **Commit:** autorizado para a infraestrutura local mesmo com o blocker temporal da amostra histórica; hash e resultado final registrados na entrega.
60. **Push origin/develop:** autorizado sob as mesmas condições; resultado final registrado na entrega.
61. **Main:** fora do escopo; não será alterada.
62. **Planilhas no Git:** não. Ambas as entradas XLSX e o CSV privado são ignorados por `.gitignore`; `git ls-files --others --exclude-standard` lista apenas `.gitkeep` da pasta privada.
63. **Dados reais versionados:** nenhum XLSX, CSV ou plano privado pode ser commitado; o commit pode conter somente infraestrutura e agregados.
64. **Recomendação Etapa 5B:** **não liberar ainda**. Obter novo export RH atual e completo, sem exclusão de negativos/colaboradores nem tratamento intermediário; informar a data real se não houver metadado confiável, repetir o dry-run e revisar warnings. Os 9 mensurados sem gestor continuam elegíveis, sinalizados para correção posterior.

## Política da Etapa 5A.1

- Antes: 9 mensurados sem gestor eram BLOCKER. Agora, os 26 sem gestor são WARNING; os 9 mensurados permanecem no plano, em sua unidade/setor/totais e no grupo `Sem gestor definido`, com `gestor = null` e `VINCULO_GESTOR_PENDENTE`. O futuro `gestor_id` pode ser `NULL`, sem gestor fictício. Visões por gestor e a futura tela de Pendências de Dados devem mostrar essa situação.
- A data de referência segue prioridade: metadado operacional confiável no XLSX; `--reference-date YYYY-MM-DD` explícita; na falta de ambos, `DATA_REFERENCIA_NAO_INFORMADA` como BLOCKER. Nunca usar timestamp de arquivo, Metodologia copiada nem data do golden master. Na primeira aplicação futura, a data forma a baseline de `aplica_a_partir_de`, sem histórico inventado.
- Sem extrato continua diferente de saldo zero. Conflitos secundários de unidade/nome são WARNING se a matrícula única determina a identidade; ambiguidade, duplicidade, unidade principal não mapeada ou saldo necessário inválido são BLOCKER. A ausência de negativos nesta amostra histórica filtrada é INFO.
- O arquivo atual é **amostra histórica parcialmente tratada**; valida estrutura e regras, mas não é candidato à primeira carga real. A futura UI de upload deverá solicitar a data quando a detecção falhar, exibir o dry-run e pedir confirmação. Não implementar essa UI nem conectar a Chamada Diária nesta etapa.
