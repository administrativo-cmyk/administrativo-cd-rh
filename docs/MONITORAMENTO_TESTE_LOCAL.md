# Monitoramento e Chamada — teste local em 17/10/2026

Este registro complementa a entrega inicial em `MONITORAMENTO_ENTREGA.md`. A aplicação continua disponível em http://localhost:3000/monitoramento. O processo Next local usa o banco remoto `administrativo-cd-rh` (`kqgtnucqxqqgwdyvhvdd`), organização Administrativo CD, branch main/Production. Um endereço local não isola as gravações do banco de produção.

## Diagnóstico autenticado inicial — antes da ativação

- O banco tinha 16 migrations, com última versão `20261008121650`. Faltavam cinco migrations locais: leitura do Banco de Horas, integridade existente, Monitoramento, revisão de fotos e fluxo da Chamada pelo ponto.
- A RPC `public.monitoring_query(text,jsonb)` não existia no destino. Essa foi a causa confirmada do erro da captura enviada. O aplicativo passou a informar instalação pendente, sem expor mensagens internas do banco.
- Foram conferidos 384 cadastros no banco, 367 disponíveis na Chamada e nenhum lançamento de Chamada. Chamada, Quadro Atual e Usuários abriram na sessão ADMIN. Monitoramento, Banco de Horas e a nova fila dependiam das migrations pendentes.
- Faltavam no servidor as variáveis `MONITORING_INGEST_TOKEN`, `MONITORING_INGEST_SOURCE_IDS` e `MONITORING_SUPABASE_SERVICE_ROLE_KEY`. Nenhum segredo foi incluído no código ou neste relatório.
- Nenhuma migration, arquivo, fotografia, vínculo ou decisão de Chamada foi gravado no banco remoto durante esse diagnóstico.

## Fase ATIVADA — carga concluída em 17/10/2026

Após autorização explícita do usuário para o destino acima, as cinco migrations foram aplicadas em produção, totalizando **21 migrations**. Antes da aplicação, dados e funções foram preservados em backup local ignorado pelo Git. A conferência após a ativação preservou **384 colaboradores, 356 medições de Banco de Horas, soma de `saldo_minutos` igual a −18.077 e zero lançamentos de Chamada**.

O servidor local recebeu a credencial privada de ingestão, o token e os IDs permitidos das fontes, sem expor seus valores. A RPC passou a existir, com chamada anônima negada. A auditoria verificou RLS ativo nas 17 tabelas examinadas e zero grants de acesso bruto para `anon`.

A primeira carga persistiu **353 pessoas do cadastro Person**; AFD, acessos e fotografias falharam nessa tentativa. O diagnóstico remoto confirmou `SQLSTATE 21000`: uma operação `UPDATE` exige cláusula `WHERE`. A correção `20261017185924_monitoring_safeupdate_compat.sql` foi então aplicada, totalizando **22 migrations remotas**.

Após a correção, a CLI confirmou **656 batidas do AFD legado e 10.212 do AFD ISO, com zero linhas rejeitadas**. A carga de acessos concluiu após repetição por falha transitória de conexão: **34.398 eventos canônicos, 34.464 ocorrências brutas, 66 repetições e 304 IDs**. A correção das fotos foi comprovada primeiro por HTTP 200 e depois pela auditoria remota das **299 fotografias persistidas e válidas**.

| Conferência após correção e reimportação, antes da conciliação RH | Resultado naquela etapa |
| --- | --- |
| Migrations remotas, incluindo a correção | 22 aplicadas |
| Fontes / arquivos completos | 4 / 4 |
| Eventos canônicos / ocorrências brutas | 45.266 / 45.717 |
| Batidas AFD confirmadas pela CLI | Legado: 656; ISO: 10.212; zero rejeitadas |
| Acessos confirmados pela CLI | 34.398 canônicos / 34.464 ocorrências; 66 repetições; 304 IDs |
| Pessoas persistidas | 353 |
| Fotografias persistidas / válidas | 299 / 299; 1.321.629 bytes no total |
| Fotos com hash divergente, tamanho inválido, base64 inválido ou sem pessoa | 0 em cada categoria |
| Linhas rejeitadas / conflitos / duplicatas canônicas / jobs pendentes | 0 / 0 / 0 / 0 |
| Vínculos RH / vínculos de conta / lançamentos de Chamada naquela etapa | 0 / 0 / 0 |
| Falhas de leitura no histórico | 1; conexão transitória resolvida na repetição |

Os resultados foram confirmados pela auditoria agregada de leitura em `scripts/monitoring-post-import-audit.sql`; a evidência local ignorada pelo Git está em `.monitoring-worker/activation/final-import-audit.json`. A comparação exata Defense encontrou 303 IDs presentes em Access e Person, um ID de acesso sem Person e 50 pessoas sem acesso. Essa correspondência interna não cria vínculo com o cadastro RH.

## Conciliação confirmada — 17/10/2026

O usuário confirmou que o ID da pessoa no Defense corresponde à matrícula RH. Na sessão autenticada do ADMIN Pedro, foram criados pela UI/API **325 vínculos exatos e únicos entre Defense Person e RH**, exigindo igualdade literal do ID/matrícula e igualdade do nome completo normalizado, sem remover zeros dos identificadores. A vigência começa em **17/10/2026**, no lote `7566310d-b156-4a77-8d2d-b7f1021eea8b`.

A auditoria de 17/10/2026 às **17:02:55, America/Sao_Paulo**, aprovou **34 de 34 verificações**. Dos 325 colaboradores vinculados, **272 têm foto e 53 não têm foto**. Permanecem **28 pessoas Defense sem vínculo**: uma coincide apenas pelo nome, com ID diferente, e 27 não têm correspondência. Nenhum vínculo foi criado somente por semelhança de nome.

Essa etapa não criou lançamentos de Chamada, vínculos de conta ou vínculos AFD, nem atribuiu retroativamente eventos históricos. O plano, o progresso e a auditoria estão nos arquivos locais ignorados `.monitoring-worker/activation/confirmed-binding-plan.json`, `confirmed-binding-progress.json` e `confirmed-binding-audit-result.json`. A captura `artifacts/monitoring-local/foto-vinculada.png` confirma a foto associada a um colaborador na lista e no detalhe do Monitoramento; a tela continua informando ausência de apuração e de eventos vinculados para a data consultada. Essa prova visual não substitui a auditoria dos 325 vínculos.

## Regra confirmada pelo usuário

O código existente **F significa Folga**. A falta injustificada usa **I**.

1. Batida válida, identificada e conciliada preenche P pela importação.
2. Sem batida, em dia previsto já encerrado e com cobertura de ponto confirmada: saldo menor ou igual a 480 minutos gera I automático. Saldo maior que 480 minutos permanece em branco, aguardando o gestor.
3. Falta de escala, identidade, saldo ou cobertura confiável mantém o item para conferência. Arquivo parcial ou com falha não comprova falta. Dias futuros, férias e ausência de jornada prevista não geram falta automática.
4. Lançamento manual e limpeza manual são preservados. Ponto tardio pode corrigir uma falta automática; não substitui uma decisão já assumida pelo gestor.
5. A fila agrupa revisão por dia e gestor. Mostra origem, saldo e pendências, exige justificativa e verifica versões ao salvar. Finalizar registra a revisão, sem escolher G ou I por conta própria.
6. G e o cálculo existente do Banco de Horas permanecem sujeitos à revisão. Havendo compensações que exijam reconciliação do saldo, o sistema não inventa minutos restantes para aplicar uma falta.

## Fotografias e identidades

As 299 fotos locais foram encontradas e decodificadas na validação da entrega inicial. A primeira tentativa de importá-las no destino falhou; após a correção, a auditoria remota confirmou 299 fotos válidas, sem divergência de hash ou tamanho inválido. Antes da conciliação, a consulta autenticada de uma foto Defense carregou o preview de 128×128 pixels sem gravar vínculo. Essa consulta exclusiva de ADMIN/RH comprovava o preview da origem; a associação aos colaboradores RH foi concluída posteriormente nos 325 vínculos descritos acima. Falhas temporárias de foto podem ser recuperadas ao atualizar ou retornar à janela.

Comparação somente local: 326 das 353 pessoas Defense têm um candidato RH pelo mesmo nome completo normalizado, zero homônimos nessa amostra e 27 sem candidato. Nome/foto são auxílio de revisão, não autorização para vincular automaticamente. Há 54 pessoas sem referência de fotografia. A auditoria dos registros AFD tipo 5 encontrou quatro candidatos PIS e três CPF; também não criou vínculos.

A conferência adicional de ID e nome encontrou 325 correspondências únicas entre ID Defense e matrícula RH, das quais 272 possuem referência de foto. Um candidato coincide somente pelo nome, com ID diferente. Zeros dos identificadores foram preservados. Essa comparação foi inicialmente somente de leitura; após a confirmação do significado do ID pelo usuário, os 325 pares exatos foram materializados na etapa de conciliação acima. Evidência detalhada restrita ao arquivo local ignorado `.monitoring-worker/review-defense-rh-identity.json`.

## Evidências e reprodução

- Suíte final: **480 testes em 49 arquivos passaram**, incluindo os testes SQL da Chamada e as regressões da revisão independente. Duração: 41,15 s. Essa contagem antecede a validação isolada do guard do pacote aplicado.
- TypeScript e ESLint passaram. As 22 migrations foram aplicadas no PGlite descartável, com regressões de integridade, permissões e Banco de Horas aprovadas.
- UI sintética em 1440×1000 e 390×844: fila, revisão, erro de concorrência e rascunho preservado. Capturas em `output/playwright/chamada/`. Essa evidência não representa dados ou gravações reais.
- Na sessão ADMIN real, a fila de 01–16/10 abriu com 528 grupos e 5.664 itens para conferência. A paginação mostra oito grupos por vez; filtros por dia e gestor reduziram corretamente para um grupo. A revisão de 16/10, ALEX T1, abriu oito colaboradores e impediu finalizar com pendências de escala e cobertura. Nenhum lançamento foi salvo durante esse teste. Captura da importação concluída em `artifacts/monitoring-local/importacao-concluida.png`.
- O teste SQL de fotos verifica ADMIN/RH permitidos, demais papéis/estados negados, isolamento de namespace e preservação de zeros nos IDs.
- Build de produção Webpack final aprovado em cópia temporária no mesmo volume às 19:08:39 UTC, incluindo o helper de fotos Sharp e a fila da UI. A `.next` do servidor aberto foi preservada. O build Turbopack nessa cópia encontrou a limitação de junction fora da raiz; o teste Webpack foi concluído sem desabilitar TypeScript.
- O pacote exato de ativação passou no PGlite: base de 16 migrations, aplicação transacional das cinco pendentes e rejeição da repetição/base alterada; zero arquivos ou decisões importados.
- Benchmark sintético da fila: 384 colaboradores × 31 dias (11.904 avaliações), consulta em 7.555 ms, 50 linhas paginadas e 31 dias agregados, RSS de 408 MiB. Setup separado: 2.987 ms. Todos os triggers estavam ativos durante a consulta; nenhuma decisão foi materializada nas fixtures. Esse resultado PGlite/WASM não comprova a latência do PostgreSQL remoto.
- Após a ativação, a existência da RPC remota e a negação de acesso anônimo foram confirmadas. A importação inicial revelou uma incompatibilidade remota não reproduzida pelo PGlite; a correção e a reimportação foram concluídas e auditadas. Concorrência entre múltiplas conexões PostgreSQL e o fluxo de uma jornada conciliada ainda exigem prova própria. Os vínculos Defense confirmados em 17/10 não criaram vínculos AFD nem retroatribuíram eventos históricos.
- Validação adicional do guard, fora dos 480 testes: quatro cenários em fixtures temporárias passaram — pacote aplicado preservado byte a byte, JSON inválido recusado, estado `applied` inválido recusado e pacote não aplicado preparado. O prepare não foi executado contra o pacote real. TypeScript e ESLint passaram novamente após a mudança.

```powershell
npm test -- --reporter=dot
npm run typecheck
npm run lint
npm run test:migrations
node scripts/monitoring-environment-check.mjs
node scripts/monitoring-photo-validation.mjs
node scripts/prepare-monitoring-activation.mjs
node scripts/validate-monitoring-activation.mjs
node scripts/validate-monitoring-activation-guard.mjs
node scripts/monitoring-build-validation.mjs --webpack
node scripts/monitoring-queue-benchmark.mjs
```

`prepare-monitoring-activation.mjs` prepara o pacote local; `validate-monitoring-activation.mjs` ensaia sua aplicação em memória. Nenhum desses dois scripts aplica migrations no destino remoto. O pacote original de cinco migrations, agora aplicado, foi registrado em `.monitoring-worker/activation/schema.sql`, com hashes e versões em `manifest.json`. Ele rejeita uma base diferente da conferida e uma aplicação repetida. Não contém arquivos de ponto, fotos, decisões ou credenciais.

O prepare agora recusa a execução antes de qualquer escrita quando `manifest.applied` é `true`, preservando o pacote aplicado. Portanto, o comando acima não deve regenerar o pacote real desta ativação. Novas migrations precisam de um novo pacote revisado, com diretório próprio e base remota novamente conferida. `validate-monitoring-activation-guard.mjs` verifica essa preservação apenas em fixtures temporárias.

## Pendências após ativação

A autorização específica para instalar e importar nesse destino foi concedida; a ativação, a correção de compatibilidade, a reimportação e a auditoria final foram concluídas. O worker local foi iniciado em modo watch, em processo oculto, com intervalo de 30 segundos para quatro fontes e checkpoints persistidos. O PID registrado foi 25752; logs de saída, erro e PID ficam em `.monitoring-worker/`, ignorado pelo Git. O servidor Next na porta 3000, PID 24660, foi preservado. Esses PIDs descrevem a verificação desta etapa e podem mudar após reinício.

O preview Defense inicial foi conferido sem criação de vínculo. Posteriormente, os 325 pares exatos Defense↔RH foram confirmados e vinculados. Permanecem pendentes a revisão das 28 pessoas Defense não vinculadas, as fotos dos 53 colaboradores vinculados sem foto e a conferência das condições de cada jornada. A aplicação em `localhost:3000` continua conectada ao banco de produção autorizado. O histórico inicial acima registra o estado anterior à autorização; não representa uma nova solicitação de permissão.

A instalação e a importação não substituem a conferência das identidades, da identidade física dos relógios, das escalas e da cobertura real. Esses dados determinam quais fotos e jornadas podem ser atribuídas com segurança. Nenhuma falta deve ser produzida apenas para preencher a tela.
