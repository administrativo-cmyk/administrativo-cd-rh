# Validação do sistema administrativo

## Separação das evidências

O ambiente local usa o Supabase de produção `administrativo-cd-rh` (`kqgtnucqxqqgwdyvhvdd`). Testes Vitest/PGlite usam dados sintéticos isolados; esses testes não autorizam a criação de colaboradores ou lançamentos fictícios em produção.

O novo pacote está separado da ativação anterior do Monitoramento. `scripts/prepare-system-activation.mjs` prepara SQL e hashes em `.monitoring-worker/activation-system-20261018/`; não executa SQL. A transação exige a lista exata das 22 migrations da base anterior e recusa uma base divergente. O pacote aplicado não pode ser sobrescrito.

Conferência somente leitura no SQL Editor autenticado, em `2026-10-18T00:40:59Z`: projeto e organização confirmados; 22 migrations até `20261017185924`, 384 colaboradores, 356 medições, zero chamadas e cinco perfis. Nenhuma das novas migrations estava aplicada nessa conferência.

Nova conferência em `2026-10-18T00:55:21Z` confirmou os mesmos valores e a lista exata das 22 versões. Registro visual: `artifacts/system-validation/supabase-target-before.png`.

Após autorização explícita do usuário, as quatro novas migrations foram aplicadas com sucesso no SQL Editor autenticado. A auditoria somente leitura capturada em `2026-10-18T01:54:39.923098Z` confirmou 26 migrations, última `20261018003605`. A ativação está comprovada; o QA autenticado das telas novas continua em andamento.

## Evidências atuais

- Validação integrada final em 17/10/2026, horário de Brasília: 636 testes passaram em 72 arquivos (`npx vitest run --maxWorkers=3 --reporter=dot`). Mensagens de erro emitidas pelos casos negativos são esperadas e não representam falha da suíte.
- `pnpm lint`, `npx tsc --noEmit` e `pnpm test:migrations` passaram. A validação SQL aplica as 26 migrations em ambiente isolado; nenhuma FK ficou sem índice.
- Build de produção isolado passou com Webpack em `2026-10-18T00:49:28Z`. Evidência: `artifacts/isolated-build/webpack.json` e respectivo log. O build não utilizou a pasta `.next` do servidor local em execução.
- Dashboards: testes de cálculos, dados ausentes, versões de todas as páginas, filtros e APIs autenticadas.
- Verificação no navegador autenticado: Quadro Atual com 384 colaboradores; Banco de Horas com 356 medições e 28 pessoas sem extrato; Chamada com 367 pessoas operacionais e ausência de marcações explicitamente separada de falta.
- Monitoramento abriu em nova aba autenticada: 384 pessoas sem resultado no período de 01/10 a 17/10/2026. Tempos aparecem como não apuráveis. O cadastro matrícula–CPF/PIS ainda é necessário para vincular batidas.
- Cadastro e férias: SQL isolado verifica escopo, versões concorrentes, referências, arquivamento/restauração, sobreposição de férias aprovadas e fila de reprocessamento cadastral.
- Notificações e preferências: SQL isolado verifica isolamento por usuário, leitura/arquivamento, atualização de avisos, permissões e versões. API recusa origem externa, ausência de sessão, perfis pendentes/bloqueados e operações inválidas.
- Pesquisa de páginas: busca por “férias” retornou planejamento e calendário na sessão real.
- Banco de Horas: manutenção de medições concluída, com criação, revisão, cancelamento, restauração, histórico, versão concorrente e recálculo dos ciclos apenas sobre medições ativas.
- Usuários e configurações operacionais: edição auditada, proteção do último ADMIN, escopo de RH e revisão/restauração de versões validados em SQL isolado. As entradas novas e as revisões usam a mesma validação estrutural.
- Pacote final aplicado com quatro migrations, de `20261018001547` a `20261018003605`. SHA-256 original do SQL preservado: `c0379b7d99bd5fe43960406acdfefbb8b8ae86f98a5905125b1ac255ec68e02f`. O manifesto local registra `applied=true`, horário da comprovação e caminhos/hashes das evidências; os hashes originais das quatro migrations permanecem inalterados.
- Ensaio do pacote exato com `node scripts/validate-system-activation.mjs`: 22 migrations anteriores mais quatro novas, cinco wrappers e dez tabelas protegidas conferidos. Registros sintéticos anteriores preservados coluna a coluna. Reexecução recusada com `MIGRATION_BASE_CHANGED`, sem alterar linhas, schema ou histórico. Evidência local em `.monitoring-worker/activation-system-20261018/synthetic-validation.json`.
- A consulta de auditoria pós-ativação foi executada com sucesso em transação somente leitura no banco sintético: JSON com 26 versões, 11 funções e oito tabelas. Nenhuma conexão com produção nesse ensaio.
- Repetição da navegação real: Chamada para Monitoramento e menu para Preferências concluíram sem `Rendering` persistente e sem avisos/erros no console. A ocorrência intermitente anterior não foi reproduzida; sua causa não foi comprovada. Após ativação, Configurações abriu sem erro 503 e a contagem real de notificações foi zero.
- Auditoria remota pós-ativação: 384 colaboradores, 356 medições, zero chamadas, cinco perfis e zero férias, avisos ou medições canceladas. Os totais anteriores foram preservados. Oito tabelas conferidas têm RLS habilitada, sem acesso anônimo e sem mutação direta por `authenticated`; cinco wrappers públicos usam `security invoker`, permitem execução autenticada e recusam execução anônima. Evidência bruta: `artifacts/system-validation/post-activation-ax.txt`; JSON extraído: `artifacts/system-validation/post-activation-audit.json`.
- As quatro fontes gravadas em `supabase_migrations.schema_migrations` foram conferidas por MD5. Os arquivos locais usam LF; os quatro MD5 remotos coincidem exatamente com o conteúdo local convertido apenas para CRLF. Isso comprova correspondência com normalização de fim de linha, não igualdade dos bytes originais. As fontes e SHA-256 originais foram preservados. Evidências: `artifacts/system-validation/applied-sources-ax.txt`, `applied-sources-audit.json` e `applied-sources-proof.json`.

## QA autenticado após ativação

- Administração consultou 384 colaboradores, três unidades, 32 gestores e 356 medições do Banco de Horas. Os formulários existentes abriram com os campos reais e justificativa; o histórico de medições informou corretamente ausência de alterações administrativas. Planejamento e calendário consultaram zero programações sem erro; a proposta carregou colaboradores reais. O filtro CD II reduziu o quadro de referência do calendário de 384 para 43. Os formulários foram fechados sem salvar, com console sem avisos ou erros. Evidências detalhadas em `DASHBOARDS_CALENDARIO_UI.md` e capturas em `artifacts/dashboards/ativacao/`.
- Configurações carregou perfil e preferências com controles habilitados. Notificações mostrou zero ocorrências e zero avisos; o formulário de criação carregou os 32 gestores e foi cancelado sem publicação.
- Usuários consultou os cinco perfis reais. O formulário de edição de um usuário GESTOR carregou nome, papel, vínculo de gestor e campo de justificativa; foi fechado sem salvar.
- Monitoramento carregou oito configurações ativas na revisão 1. A edição de Regras de cálculo do destino `global` preencheu repetição de ponto em 60 segundos, acesso em 10 segundos e vigência; tipo e destino permaneceram travados. Cancelar retornou ao formulário padrão sem salvar. O navegador não registrou avisos nem erros. Evidência: `artifacts/system-validation/monitoring-settings-ax.txt`.
- As quatro rotas de Análises foram consultadas com sessão real: Top 20 apresentou 20 créditos e 20 débitos, com cobertura de extratos de 356/384 (92,71%); comparação por gestor apresentou 33 grupos; Afastados e Outros apresentou 17/384 (4,43%); Metodologia apresentou os critérios completos. Nenhum erro de consulta ou console. Evidências em `DASHBOARDS_CALENDARIO_UI.md` e `artifacts/dashboards/ativacao/analise-*.jpg`.
- Os Advisors foram executados novamente pela interface autenticada. Security Advisor: zero erros e um aviso, `Leaked Password Protection Disabled`, referente ao Supabase Auth; essa configuração não foi alterada. Performance Advisor: zero erros e zero avisos. Há sugestões informativas nas ferramentas; esses resultados não significam ausência de toda sugestão nem substituem teste de carga. Evidências: `artifacts/system-validation/security-advisor-ax.txt` e `performance-advisor-ax.txt`.

O QA comprova consulta autenticada e abertura dos formulários indicados. Não houve teste de gravação administrativa em produção; criação, edição, cancelamento, restauração e concorrência foram exercitados nos testes isolados. A configuração operacional do Monitoramento e as quatro rotas de Análises foram conferidas.

## Situação final e limites dos dados

- Implementação e validação do objetivo concluídas: quatro dashboards separados, Planejamento, Análises, Administração, notificações, configurações e operações persistidas. Banco de produção atualizado; interface disponível no servidor local `http://localhost:3000/dashboards`. Esta entrega não representa publicação de uma nova versão de frontend hospedada.
- A exportação dos usuários do relógio foi adiada pelo usuário. Vínculos matrícula–CPF/PIS ainda precisam dessa fonte. Apuração de jornada também exige escala e cobertura válidas; o sistema apresenta dados não apuráveis explicitamente, sem fabricar horas ou faltas.
- Nenhum cadastro, aviso ou planejamento fictício foi criado em produção para testar as novas telas.
