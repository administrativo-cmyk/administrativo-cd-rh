# Supabase remoto — Administrativo CD

> Estado conferido em **18/10/2026: banco de produção ativado e auditado com 32 migrations**, última versão `20261018022234`. As seis migrations complementares foram aplicadas após autorização; dez fingerprints preservados, 384 colaboradores, 356 medições de Banco de Horas e 299 fotos. Runtime local e tarefa de logon ativados; aplicação **PUBLICADA** em [administrativo-cd-rh.vercel.app](https://administrativo-cd-rh.vercel.app). Sessão RH autenticada e CRUD reais ainda não foram testados na Vercel. Evidências: [CRUD_COMPLEMENTAR_VALIDACAO.md](CRUD_COMPLEMENTAR_VALIDACAO.md). O histórico abaixo mantém os números de cada etapa.

## Destino autorizado

- Organização: `Administrativo CD`
- Projeto: `administrativo-cd-rh`
- Referência: `kqgtnucqxqqgwdyvhvdd`, branch main/Production
- Região: South America (São Paulo), `sa-east-1`
- Criado em: 2026-09-24
- Situação em 18/10/2026: 32 migrations aplicadas em produção, incluindo os complementos administrativos; 325 vínculos Defense Person↔RH preservados, com a vigência confirmada em 17/10/2026

O projeto `supabase-almond-village` contém dados de outro aplicativo e está fora do escopo do App RH. Ele não deve ser vinculado, migrado ou alterado por este workspace.

## Ativação complementar em 18/10/2026

Após as quatro migrations administrativas que elevaram o banco de 22 para 26 versões, o usuário autorizou e foram aplicadas as seis migrations complementares:

1. `20261018021801_canonical_catalogs_and_planning.sql`
2. `20261018021828_daily_call_batch_attachments_notifications.sql`
3. `20261018021924_monitoring_binding_sources_operational_imports.sql`
4. `20261018022114_workspace_operational_notifications.sql`
5. `20261018022209_central_audit_history.sql`
6. `20261018022234_schedule_calendar_vacation_planning.sql`

O total remoto confirmado é **32 migrations**. O manifest registra aplicação em **2026-10-18T04:09:57.905957Z**, verificação em **2026-10-18T04:11:50.728Z** e `applied: true`. A auditoria antes/depois confirmou **dez fingerprints preservados**, **384 colaboradores**, **356 medições de Banco de Horas**, **299 fotos** e **zero lançamentos de Chamada**. A revisão verificou **21 funções e 22 tabelas protegidas**. Há 72 registros de catálogo, 72 aliases e 384 registros de preservação dos valores legados dos colaboradores.

Manifest, pacote e evidências reais permanecem locais e ignorados pelo Git, em `.monitoring-worker/activation-complementary-20261018`, incluindo `post-activation-audit.json`, `preservation-before.json` e `preservation-after.json`. Nenhuma credencial é incluída nesses documentos versionados.

A suíte local final passou com **751/751 testes em 93 arquivos**. O build Webpack terminou com **exit 0** na release `validated-i1dOqr`. Essas evidências validam o código local; a aplicação das migrations e a preservação dos dados são comprovadas separadamente pelas auditorias remotas acima.

O projeto Vercel **`administrativo-cd/administrativo-cd-rh` está publicado** em [administrativo-cd-rh.vercel.app](https://administrativo-cd-rh.vercel.app), usando **`develop`** como branch de produção. Deployment **`dpl_9P5sAagmR8oNxjB3Hsb2SnDVGohM`**, commit **`43cb175a463e520ec97063100bf03f04f15a7d2f`**, **Ready em 18/10/2026 às 05:34:49 BRT**. Build de **1 minuto e 54 segundos**, **pnpm 10.28.0** e **Sharp 0.35.4 para Linux**. As seis variáveis de Production, quatro configurações e dois segredos de servidor, foram salvas após autorização específica.

Às **2026-10-18T08:35:12.372Z**, os **dez checks** de `artifacts/complementary-validation/vercel-production-smoke.json` passaram, incluindo token de servidor e RPC Supabase somente leitura com `sources: []`. A amostra de **12 assets do cliente** não continha valores dos segredos de servidor conhecidos. O login no navegador carregou **duas imagens, sem erros no console**. **Sessão RH autenticada e CRUD reais na Vercel não foram testados**.

O runtime local foi ativado na release de produção **`validated-i1dOqr`**, restrita a **`127.0.0.1:3000`**. A tarefa de logon **`Administrativo CD - Importador` está `Running`**. A evidência de **2026-10-18T04:21:47.3501283Z** registra **um worker**, após teste real de recuperação em **10 segundos**, e health `ready`. Evidência: `artifacts/complementary-validation/runtime-activation.json`, local e ignorada pelo Git. O worker continua usando o endpoint local e o mesmo banco Supabase de produção; configuração e processos não foram alterados pela publicação.

O registro operacional posterior mostrou **um reinício inesperado às 05:09:06 BRT**, recuperado automaticamente em **6,7 segundos**, sem interromper supervisor ou servidor. Às 05:35 BRT havia um único worker e saúde `ready`. A causa não foi determinada; o supervisor atual não preserva stdout/stderr dos filhos. Evidência local: `.monitoring-worker/runtime/events.jsonl`.

Na interface local autenticada, o Quadro apresentou **384 colaboradores** e o Monitoramento carregou sem falha. A primeira página confirmou **15 fotos carregadas e zero quebradas**; as demais imagens com carregamento sob demanda não foram validadas nessa amostra. Essa verificação local é separada dos testes públicos da Vercel.

## Ativação autorizada em 17/10/2026

O usuário autorizou a aplicação das cinco migrations pendentes e a importação no projeto acima. A aplicação foi concluída, elevando o histórico remoto de 16 para **21 migrations**:

1. `20261008132607_bank_hours_read_scope.sql`
2. `20261017165920_existing_integrity.sql`
3. `20261017165932_monitoring.sql`
4. `20261017175455_monitoring_identity_photo_review.sql`
5. `20261017175802_daily_call_punch_workflow.sql`

Dados e funções foram preservados em backup local ignorado pelo Git antes da aplicação. A conferência após a ativação manteve **384 colaboradores, 356 medições de Banco de Horas, soma de `saldo_minutos` igual a −18.077 e zero registros em `chamada_diaria`**.

As variáveis `MONITORING_SUPABASE_SERVICE_ROLE_KEY`, `MONITORING_INGEST_TOKEN` e `MONITORING_INGEST_SOURCE_IDS` foram configuradas no ambiente privado do servidor local. Seus valores não constam deste documento nem do código. A RPC `monitoring_query` está presente e o acesso anônimo foi negado. A auditoria encontrou **17 tabelas examinadas com RLS ativo e zero grants de acesso bruto para `anon`**.

## Correção aplicada e importação auditada

A carga inicial persistiu **353 pessoas do cadastro Person**; AFD, acessos e fotografias falharam nessa tentativa. O diagnóstico remoto identificou `SQLSTATE 21000`, por operação `UPDATE` sem cláusula `WHERE`. A migration corretiva `20261017185924_monitoring_safeupdate_compat.sql` foi aplicada, elevando o total remoto para **22 migrations**.

A CLI confirmou a reimportação de **656 batidas do AFD legado e 10.212 do AFD ISO, com zero rejeitadas**. A carga de acessos concluiu após repetição por erro transitório de conexão: **34.398 eventos canônicos, 34.464 ocorrências brutas, 66 repetições e 304 IDs**. Após o ajuste das fotografias, a auditoria remota confirmou **299 fotos persistidas e válidas**, sem divergência de hash, tamanho inválido, base64 inválido ou foto sem pessoa.

| Auditoria após correção e reimportação, antes da conciliação RH | Resultado naquela etapa |
| --- | --- |
| Total de migrations remotas | 22 aplicadas |
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

A auditoria agregada de `scripts/monitoring-post-import-audit.sql` foi conferida no destino autorizado. A evidência local, sem versionamento, está em `.monitoring-worker/activation/final-import-audit.json`. A comparação exata Defense encontrou 303 IDs compartilhados entre os 304 IDs de Access e as 353 pessoas de Person, um ID de acesso sem Person e 50 pessoas sem acesso.

Candidatos apenas por nome continuam sujeitos a revisão explícita; a importação não autoriza vínculos automáticos. Na etapa anterior à conciliação, as fotos estavam persistidas sem associação aos colaboradores RH. Um preview Defense de 128×128 pixels carregou na UI autenticada sem gravar vínculo. Os vínculos confirmados posteriormente estão registrados na seção seguinte.

Na etapa de 17/10/2026, o worker local foi iniciado em modo watch, com intervalo de 30 segundos para quatro fontes e checkpoints persistidos, em processo oculto. Logs e PID ficaram em `.monitoring-worker/`, ignorado pelo Git, e o servidor Next na porta 3000 foi preservado. Esse registro histórico é anterior ao supervisor e ao autostart ativados e verificados em 18/10/2026, conforme a seção de ativação complementar acima. **A aplicação local usa este banco de produção**.

## Conciliação confirmada em 17/10/2026

Após o usuário confirmar que o ID Defense corresponde à matrícula RH, a sessão autenticada do ADMIN Pedro criou **325 vínculos exatos e únicos Defense Person↔RH pela UI/API**. Cada par apresentou ID/matrícula literalmente iguais e nome completo normalizado igual, preservando zeros dos identificadores. A vigência começa em **17/10/2026**; o lote é `7566310d-b156-4a77-8d2d-b7f1021eea8b`.

A auditoria concluída às **17:02:55, America/Sao_Paulo**, aprovou **34 de 34 verificações**. Os vínculos incluem **272 colaboradores com foto e 53 sem foto**. Das 353 pessoas Defense, **28 permanecem sem vínculo**: uma coincide somente pelo nome, com ID diferente, e 27 não têm correspondência. Nenhum vínculo por nome isolado foi criado.

Não houve criação de lançamentos de Chamada, vínculos de conta ou vínculos AFD, nem atribuição retroativa de eventos históricos. Plano, progresso e auditoria permanecem locais e ignorados pelo Git: `.monitoring-worker/activation/confirmed-binding-plan.json`, `confirmed-binding-progress.json` e `confirmed-binding-audit-result.json`. A captura `artifacts/monitoring-local/foto-vinculada.png` confirma a foto de um colaborador na lista e no detalhe do Monitoramento. Ela não comprova uma jornada apurada; a auditoria dos 325 vínculos foi realizada separadamente.

## Histórico da fundação — setembro de 2026

As seções seguintes preservam o registro original da fundação. As oito migrations, sete tabelas e contagens vazias descritas aqui se referem àquela etapa, anterior aos dados reais e à ativação acima.

### Migrations aplicadas naquela etapa

1. `20260923204012_domain_foundation.sql`
2. `20260923204014_bank_hours.sql`
3. `20260923204015_daily_attendance.sql`
4. `20260923204017_views_indexes_rls.sql`
5. `20260924143652_seed_reference_units.sql`
6. `20260924195656_authentication_profiles_approval.sql`
7. `20260925112752_harden_auth_rpc_exposure.sql`
8. `20260925120000_enforce_auth_identifier_binding.sql`

### Estrutura criada naquela etapa

Tabelas:

- `unidades`
- `gestores`
- `lotes_importacao`
- `colaboradores`
- `banco_horas_medicoes`
- `chamada_diaria`
- `perfis`

Views com `security_invoker = true`:

- `vw_colaboradores_mensurados`
- `vw_banco_horas_ciclos`
- `vw_banco_horas_atual`
- `vw_banco_horas_resumo`
- `vw_chamada_diaria_contexto`

Unidades estruturais:

- `CD I`
- `CD II`
- `CD FLV`

### Segurança e exposição verificadas naquela etapa

- RLS está habilitado nas sete tabelas.
- As seis tabelas operacionais continuam sem policies de aplicação e sem grants para `anon` ou `authenticated`.
- `perfis` permite ao usuário autenticado apenas a leitura das colunas mínimas do próprio perfil; não existe `UPDATE` genérico.
- A administração de perfis usa wrappers públicos `SECURITY INVOKER` e implementações privilegiadas no schema `private`, com validação de papel no banco.
- O projeto mantém os privilégios padrão da plataforma para futuros objetos do schema `public`; essa configuração global da Data API não foi alterada.
- As implementações privilegiadas estão no schema `private` com `SECURITY DEFINER`, `search_path` vazio e execução revogada de `public`, `anon` e `authenticated`; apenas wrappers públicos `SECURITY INVOKER` com grants mínimos são expostos.
- O trigger de criação valida que o e-mail técnico corresponde ao SHA-256 do CPF normalizado antes de persistir o perfil e remove o CPF do metadata de Auth após o uso.
- Auth e `perfis` permanecem com zero registros após a remoção dos usuários fictícios de teste.
- Storage permanece com zero buckets.
- Nenhuma Edge Function foi criada ou implantada.

### Dados naquela etapa

Nenhum gestor, colaborador, lote, saldo de banco de horas ou chamada diária real foi importado. Somente as três unidades estruturais foram persistidas. Os testes SQL remotos usaram dados fictícios dentro de transação com `ROLLBACK`, e a ausência desses registros foi confirmada depois.

### Aplicação naquela etapa

O frontend continua usando `MockDailyCallRepository` para Chamada Diária e demais dados operacionais. A autenticação usa o projeto remoto oficial por meio de URL e chave publicável no ambiente local ignorado pelo Git; nenhuma chave secreta é exposta ao navegador ou versionada.
