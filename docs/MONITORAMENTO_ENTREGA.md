# Monitoramento do CD — entrega local e roteiro de aceite

Data: 17/10/2026. Base: `develop`, HEAD inicial `a76acdb6a0f8921743d1a9de85a631d34fc203e3`, igual à referência auditada. A árvore versionada estava limpa. Prompt e fontes Defense estavam locais; arquivos originais foram preservados. Não havia índice CodeGraph. A documentação da versão instalada do Next foi consultada.

## Resultado e fronteira de evidência

Implementação local funcional integrada à navegação: `/monitoramento`, consulta com filtros e paginação, detalhe sob demanda, conciliação, fotos, importação, nove tipos de configuração, reprocessamento e CSV. As correções solicitadas da base administrativa também foram implementadas.

Os testes SQL executaram em **PGlite descartável em memória**, com fixtures sintéticas e uma execução controlada dos arquivos reais locais. Não houve conexão de escrita com Supabase remoto, migration remota, commit, push ou deploy nesta entrega. A interface foi validada com componentes reais e respostas sintéticas controladas; isso não representa aceite autenticado em homologação ou produção. O worker contínuo não foi instalado como serviço nem deixado enviando arquivos.

## Matriz de funcionalidades

| Área | Estado local | Evidência principal |
| --- | --- | --- |
| Chamada: data fora do período, PUT tardio, rascunho e sincronização | Corrigido e testado | `hooks/use-daily-call.ts`, `components/daily-call-observation.tsx`, testes correspondentes |
| Quadro/BH: detalhe atual e saldo parcial | Corrigido e testado | `components/workforce-app.tsx`, `components/time-bank-app.tsx`, `lib/time-bank-selectors.ts` |
| Datas finitas, proveniência obrigatória, CPF administrativo | Corrigido em nova migration | `supabase/migrations/20261017165920_existing_integrity.sql` |
| RH: mesmos bytes para parsing e hash; tipos de persistência | Corrigido; travas da baseline preservadas | `scripts/import-hr-data.ts`, `lib/hr-import/`, `lib/persistence/database.types.ts` |
| AFD legado/ISO, AccessRecords e Person | Implementado e validado com arquivos reais | `lib/monitoring/ingestion/`, `test/monitoring-ingestion.test.ts` |
| Varredura, watch, retomada, foto tardia e fila | Implementado e testado | `scripts/monitoring-import.ts`, `scripts/monitoring-local-validation.ts` |
| Jornada, descanso, localização, café, atraso e exceções | Implementado e testado com cenários sintéticos | `lib/monitoring/domain/`, `lib/monitoring/reprocess.ts` |
| Persistência, RLS, RPCs, auditoria e leases | Implementado; 19 migrations aplicadas localmente | `supabase/migrations/20261017165932_monitoring.sql`, `supabase/tests/monitoring.sql` |
| Consulta, detalhes, importação, configurações e fotos | Implementado; testes e conferência visual | `app/monitoramento/`, `components/monitoring/`, `components/employee-avatar.tsx` |
| Exportação autorizada e filtrada | CSV real, proteção de fórmulas e versão consistente | `app/api/monitoring/export/route.ts`, `lib/monitoring/export.ts` |
| Conciliação real RH–Defense–CPF/PIS | Depende de fonte confiável ausente localmente | Inventário em `monitoramento-importacao.md` |
| Ativação remota e aceite autenticado | Pendente de autorização e ambiente | Roteiro abaixo |

ADMIN/RH configuram, conciliam e reprocessam. LEITURA aprovado consulta todos os colaboradores, inclusive fotos e exportações, sem escrita; esse é o escopo explícito adotado a partir do papel existente. GESTOR consulta somente colaboradores vinculados ao seu gestor, abrangendo várias unidades quando pertinente; sem vínculo, retorna escopo vazio. Sessão pendente/bloqueada/anônima não concede leitura. A foto da própria conta exige vínculo explícito com o colaborador e não amplia acesso aos registros dele.

## Arquivos reais: o que foi verificado

| Fonte | Resultado |
| --- | --- |
| AFD legado | 656 batidas, 79 PIS; fragmento sem cabeçalho/trailer |
| AFD ISO | 10.212 batidas, 316 CPF; fragmento sem cabeçalho/trailer |
| AccessRecords | 34.464 ocorrências, 34.398 equivalências canônicas, 304 IDs |
| Person | 353 IDs, incluindo 15 com zero inicial |
| Fotografias | 299 referências e 299 arquivos decodificados; 54 pessoas sem referência |
| Correspondência Defense | 303 IDs exatos entre acesso e Person; um órfão; 50 cadastros sem acesso naquele período |

A carga real descartável resultou em **45.266 eventos, 45.717 ocorrências, 353 cadastros/snapshots e 299 fotos**. Segunda carga e renomeio mantiveram contagens. Nenhum vínculo RH foi inventado. A contagem inclui eventos anônimos, negados e alarmes preservados; somente eventos elegíveis podem alterar localização.

Os snapshots Person não contêm histórico confiável de atualização. Diferenças entre arquivos são preservadas nas ocorrências e marcam `ambiguous`; a representação resumida usa ordem determinística por hash, sem afirmar que é o cadastro mais recente. Grupos atuais não são aplicados ao passado sem configuração de vigência e evidência.

Medição da última carga real: ingestão SQL 26.956 ms; replay/renomeio 3.491 ms; total 60.084 ms; RSS observado 1.123 MiB. Benchmark sintético: 40.000 acessos em 4.649 ms e 12.000 batidas em 662 ms; RSS 714 MiB, incluindo geração do XLSX. Valores locais, sem promessa de desempenho remoto.

## Validação executada

Baseline: 239 testes em 27 arquivos, typecheck aprovado. Validação final: **391 testes em 38 arquivos aprovados**, typecheck e ESLint aprovados, **19 migrations** aplicadas com regressões passando e **build de produção aprovado**, sem desabilitar TypeScript. A suíte levou 27,54 s. O build Next 16.3.4 compilou em 2,6 s, concluiu TypeScript em 6,8 s e gerou as 25 rotas/páginas, incluindo Monitoramento e suas APIs.

Os cenários abrangem conservação de tempo, descanso excluído, turnos noturnos, limiar de atraso estritamente superior a 900 segundos, ausência de escala/cobertura, mudanças de grupo, repetições com direções opostas, conflito de NSR, arquivo interrompido, troca de tamanho de lote na retomada e idempotência. Integração adicional usa os valores reais da migration inicial, adapta o snapshot SQL, persiste resultado e confere o agregado autenticado: exclusão de fora da operação preserva atraso elegível.

Autorização SQL verificada por papéis: gestor de duas unidades, outra equipe por UUID/foto, gestor sem vínculo, LEITURA sem escrita, pendente, anônimo, tabelas brutas e RPCs privilegiadas. Versão dos insumos, histórico, lease exclusivo, lease vencido/reutilizado e retry têm testes locais. PGlite serializa suas chamadas; falta prova de concorrência com múltiplas conexões em PostgreSQL real. Docker está instalado, mas o engine não estava disponível; não foi iniciado automaticamente.

Validação visual sintética em 1440 × 1000 e 390 × 844: consulta, detalhe, conciliação, configuração e importação; ausência de overflow global e erros de navegador; rascunho preservado após conflito. Reproduzível por `node scripts/monitoring-visual.mjs`; evidências locais ignoradas pelo Git em `artifacts/monitoring-visual/`.

```powershell
Set-Location 'D:\PROJETOS\INDICADOR CD FACIAL'
pnpm typecheck
pnpm lint
pnpm test
pnpm test:migrations
pnpm build
node scripts/monitoring-visual.mjs
node --experimental-strip-types scripts/monitoring-local-validation.ts --synthetic
# Leitura e carga real somente no banco descartável em memória:
node --experimental-strip-types scripts/monitoring-local-validation.ts --real --config monitoramento.example.json
```

## Instalação e habilitação

1. Use Node >= 22.13 e as dependências do lockfile (`pnpm install --frozen-lockfile`). Confira `.env.example`; nunca copie segredos para o JSON do worker ou Git.
2. Prepare banco isolado de homologação. As duas migrations novas dependem das 17 anteriores. Valide destino, projeto e backup antes de uma aplicação remota autorizada. Constraints novas podem recusar dados legados inválidos; investigar esses dados sem removê-los automaticamente.
3. Servidor: `NEXT_PUBLIC_SUPABASE_URL`, chave publicável existente, `APP_ORIGIN`, `MONITORING_INGEST_TOKEN`, `MONITORING_INGEST_SOURCE_IDS` e `MONITORING_SUPABASE_SERVICE_ROLE_KEY`. A chave privilegiada é exclusiva do servidor. O token deve ser aleatório, ter ao menos 32 caracteres e existir também no ambiente do worker. A lista de fontes permitidas é obrigatória.
4. Execute `pnpm dev` para desenvolvimento ou `pnpm build`/`pnpm start` para o servidor local. Configure o destino no JSON conforme o ambiente realmente escolhido. `/api/monitoring/*` valida sessão/papel ou token em cada endpoint, independentemente do proxy de páginas.
5. Siga [monitoramento-importacao.md](monitoramento-importacao.md) para copiar o exemplo, conferir as pastas, rodar dry-run e iniciar varredura única/watch. O endpoint padrão do exemplo é loopback em porta 3000; o site hospedado não lê pastas deste computador.
6. Após a carga autorizada, ADMIN/RH usa Conciliação e Configuração para estabelecer vínculos com evidência, escalas, cobertura, grupos e natureza das batidas. Confirme fisicamente a identidade dos relógios antes de marcar `sourceIdentityConfirmed`.
7. O worker solicita recálculo da fila ao fim de cada varredura, mesmo sem novos arquivos. Até 1.000 jobs são processados por varredura; excedentes permanecem pendentes. O recálculo manual por pessoa/data exige motivo. Resultados antigos ficam sinalizados como desatualizados até a conclusão.

Consulte [monitoramento-regras.md](monitoramento-regras.md) para parâmetros, exemplos numéricos e precedência das exceções. Fotos entram pelo cadastro Defense, sem criação obrigatória de conta. Após vínculo explícito, a foto aparece no cadastro/consultas existentes e, quando configurado, no perfil da conta. Servidor serve miniaturas privadas sem cache público; originais permanecem na pasta autorizada.

## Recuperação

Falhas de arquivo ficam no histórico com código, caminho relativo e tentativa. O worker aguarda estabilidade e tenta novamente; confirmação HTTP sem estado final não conclui checkpoint. Reenvio do arquivo inteiro é seguro pela unicidade no banco, inclusive após perda do checkpoint. Não remova tabelas para recuperar uma importação.

Mudança de namespace/tipo/fuso de uma fonte existente é rejeitada. Arquivo com mesmo nome e bytes novos recebe nova proveniência. Mesmo NSR divergente gera conflito; não há sobrescrita silenciosa. Uma nova foto pode chegar depois do Person: a próxima varredura verifica seu checkpoint independente.

Erro de recálculo libera retry; lease impede finalização por uma tentativa antiga. Alteração de insumos durante o cálculo retorna conflito de versão. Refaça a consulta e o recálculo, preservando histórico. Mensagens de erro usam referência de correlação e códigos sanitizados; logs não incluem conteúdo dos arquivos, identificadores pessoais ou fotos.

## Dependências externas que permanecem

- Tabela confiável de correspondência matrícula/UUID RH ↔ ID Defense ↔ CPF/PIS. A fonte RH local disponível no código não fornece esses campos; não foi encontrada planilha adicional de correspondência.
- Horário previsto de início, dias, escala e evidência de natureza das batidas. Duração contratual sozinha não fornece horário de entrada.
- Identidade física dos dois relógios fragmentados e especificação de CRC da família correspondente. CRC permanece não verificado.
- Cobertura contínua declarada por fonte/equipamento/período. Extremos de timestamp não comprovam coleta integral.
- Orientação física da Entrada Principal e uma saída de perímetro identificada. Sem isso, tempo fora do CD permanece indeterminado; intervalo entre eventos tem rótulo próprio.
- Fotografia para as 54 pessoas sem referência, se desejada. As outras 299 foram encontradas; não há ausência geral de fotos.

## Aceite após habilitação autorizada

1. Entrar como ADMIN/RH e importar as amostras. Conferir contagens e fotos. Reimportar/renomear e confirmar estabilidade; provocar interrupção e retomar.
2. Conciliar uma pessoa usando tabela confiável. Confirmar foto sem precisar criar conta; depois vincular uma conta aprovada e conferir sua foto.
3. Cadastrar escala, evidências, grupos históricos e cobertura reais. Recalcular uma jornada conhecida e conferir cada intervalo com arquivo/linha, descanso e atraso. Não confirmar campos apenas para obter um número.
4. Validar cenário 08–12/13–17 com saída 11:50 e retorno 13:10: W=480 min e fora=20 min. Testar atraso 15:00, 15:01 e 16:00; turno 22–02/03–06; café sobreposto sem somar indicadores.
5. Alterar regra com vigência justificada e verificar fila, histórico, exclusão somente no indicador escolhido e resultado atualizado.
6. Como GESTOR, conferir ambas as unidades de sua equipe e negar UUID/foto/exportação de outra equipe. Repetir com gestor sem vínculo, LEITURA, pendente e bloqueado.
7. Exportar filtros iguais aos da consulta e comparar qualidade, totais, versão e ausência versus zero. Conferir layout no celular e teclado/foco no detalhe.
8. Repetir regressões da Chamada/BH descritas em [monitoramento-correcoes.md](monitoramento-correcoes.md). Verificar concorrência PostgreSQL com duas conexões e o servidor autenticado antes da liberação operacional.

## Backlog preservado

| Prioridade | Escopo não concluído nesta entrega |
| --- | --- |
| P1 | Aceite autenticado e implantação autorizada; dados de conciliação, escala e cobertura; recuperação de senha completa |
| P2 | Férias e movimentações com regras e persistência aprovadas; exportação da Chamada; ações em lote |
| P3 | Dashboard, rankings, Top 20/por gestor, Afastados e Outros, Metodologia e Configurações antigas; OAuth Google e controles auxiliares do cabeçalho |

As abas Configuração/Importação do Monitoramento são funcionais; isso não conclui a página antiga de Configurações ou outros módulos. Documentos anteriores de arquitetura, Auth frontend e estado remoto são registros históricos da etapa indicada. Este relatório define a entrega atual; informações remotas antigas não foram revalidadas nesta sessão.
