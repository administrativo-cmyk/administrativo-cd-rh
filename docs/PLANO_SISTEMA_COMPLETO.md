# Administrativo CD — execução do objetivo completo

Objetivo iniciado em 17/10/2026: analisar o projeto inteiro e entregar páginas separadas de indicadores para Monitoramento, Chamada Diária, Banco de Horas e Quadro Atual, além de Planejamento, Análises, Administração, notificações e configurações com operações completas e persistidas.

## Diagnóstico inicial confirmado no código

- Os quatro módulos operacionais consultam RPCs reais e aplicam autorização. Não devem retornar fixtures em falhas.
- O menu tinha oito entradas sem destino: Dashboard, duas de Planejamento, quatro de Análises e Configurações.
- Pesquisa global, atalho Ctrl K, notificações, perfil e preferências não executavam ações.
- Unidades, gestores e colaboradores existiam no banco, mas não havia CRUD administrativo na aplicação.
- Aprovação, bloqueio, reativação e vínculo de gestor de usuários existiam; edição de papéis já aprovados e auditoria administrativa ainda precisam ser completadas.
- Planejamento de férias, notificações persistentes e preferências não tinham tabelas ou APIs próprias.
- Monitoramento tem configuração versionada e revogação; faltam fluxos de edição e recuperação de configurações.
- Chamada tinha exportação desabilitada e contrato de unidades fixo em três códigos, incompatível com novos cadastros.
- As importações reais estão disponíveis, mas indicadores de jornada dependem de identidade, escala e cobertura. Dados não apuráveis devem permanecer distintos de zero.

## Requisitos e evidências de conclusão

| Área | Entrega exigida | Evidência necessária | Estado |
| --- | --- | --- | --- |
| Dashboards | Índice e quatro páginas independentes, filtros, métricas, gráficos, tabelas, exportação e links operacionais | Testes dos cálculos, autorização das consultas, navegação e verificação autenticada desktop/mobile | Implementado; validação integrada aprovada |
| Monitoramento | Cobertura, qualidade, tempo trabalhado, fora da operação, refeitório e atrasos com denominadores explícitos | Totais de todo o conjunto, consistência entre páginas e ausência de cobertura tratada como indisponível | Implementado; validação integrada aprovada |
| Chamada | Marcações por status/origem, evolução diária, pendências e taxa com base declarada | Nenhuma falta inferida apenas por célula vazia; filtros e exportação conferidos | Implementado; validação integrada aprovada |
| Banco de Horas | Saldos positivos/negativos, compensações, reposições, sem extrato, distribuição e maiores saldos | Preservação dos ciclos existentes e sinal dos saldos; sem histórico inventado | Implementado; validação integrada aprovada |
| Manutenção do Banco de Horas | Criar, revisar, cancelar e restaurar medições com histórico auditado | CAS, ciclos recalculados sobre medições ativas, permissões ADMIN/RH e preservação da Chamada manual | Implementado; validação integrada aprovada |
| Quadro Atual | Efetivo, situações, unidades, gestores, funções e qualidade cadastral | Cadastro atual identificado como atual, sem fingir série histórica | Implementado; validação integrada aprovada |
| Planejamento | Cadastro, edição, consulta, arquivamento/restauração de propostas de férias, calendário e aprovação por papel | Persistência, conflitos de datas, concorrência e acesso do gestor à própria equipe | Ativação, consulta e formulários autenticados conferidos; mutações testadas isoladamente |
| Análises | Top 20, comparação por gestor, afastados e metodologia | Rotas funcionais com fontes reais, filtros e exportação | Implementado; quatro rotas autenticadas conferidas |
| Administração | CRUD de unidades, gestores, colaboradores e gestão completa de usuários | Validação, autorização no banco, auditoria, concorrência e preservação de referências | Implementado; validação integrada aprovada |
| Notificações | Caixa por usuário, estados lido/não lido/arquivado e avisos de ocorrências relevantes | Estado persistido, contagem real e isolamento entre usuários | Ativação, consulta e formulário autenticados conferidos; mutações testadas isoladamente |
| Configurações | Perfil, preferências e configurações operacionais com leitura/edição e histórico adequado | Persistência, permissão e efeito real das opções | Consultas e formulários autenticados conferidos; mutações testadas isoladamente |
| Navegação | Entrada inicial, menu, busca de páginas, atalho e links do cabeçalho | Nenhuma ação sem destino, acesso por teclado e ausência de rotas quebradas | Implementado; validação integrada aprovada |
| Integração | Cadastros novos utilizáveis nos quatro módulos | Unidades dinâmicas, referências e escopos consistentes | Implementado; validação integrada aprovada |
| Validação final | Testes, lint, tipos, migrations, build e fluxos reais autorizados | Resultados atuais registrados; teste local separado de ativação remota | Ativação e QA autenticado concluídos |

## Decisões de implementação

- Manter a identidade visual existente: navegação azul escura, conteúdo claro, foco nos dados e controles legíveis.
- O índice de dashboards apresenta quatro destinos. Cada página mantém somente os indicadores do seu domínio.
- Usar o usuário autenticado e as RPCs com escopo existente, sem chave administrativa no navegador.
- Alterações cadastrais devem registrar autor, motivo e versão. A remoção de cadastros com histórico deve preservar as referências por arquivamento reversível.
- Dados de férias constituem planejamento explícito; não substituir decisões manuais da Chamada nem gerar lançamentos automaticamente sem regra e validação próprias.
- A confirmação de identificação do relógio e o cadastro matrícula–CPF/PIS continuam necessários para atribuir as batidas. A ausência desses dados não bloqueia a implementação das telas e dos cálculos com estados de qualidade claros.
- Nenhum item está concluído apenas porque existe uma página ou um teste passou. A conclusão do objetivo exige evidência para todas as linhas acima.

## Progresso confirmado

Dashboards e Análises foram implementados com fontes reais, autorização e testes. Os quatro painéis passaram por navegação autenticada; o CSV de Banco de Horas foi baixado. Calendário e Administração têm consultas com versão do conjunto para evitar mistura de páginas durante alterações. Chamada exporta os colaboradores filtrados e aceita unidades cadastradas dinamicamente.

Notificações, preferências, perfil e busca de páginas foram implementados. CRUD cadastral e de férias, edição de usuários e revisões das configurações possuem testes isolados de permissões, concorrência e histórico. A manutenção das medições do Banco de Horas foi concluída. A validação integrada passou: 636 testes, tipos, lint, 26 migrations e build de produção isolado.

Após autorização explícita do usuário, o pacote de quatro novas migrations foi aplicado. A auditoria remota somente leitura de `2026-10-18T01:54:39.923098Z` confirmou 26 versões, última `20261018003605`, totais anteriores preservados, RLS e grants esperados. Os MD5 das quatro fontes aplicadas coincidem com os originais após converter apenas LF para CRLF; hashes originais preservados. Configurações já abre sem 503 e notificações mostra a contagem real zero. O QA autenticado final foi concluído; o sistema local está disponível para uso. Evidências em `SISTEMA_COMPLETO_VALIDACAO.md`.

QA após ativação confirmou consultas e abertura dos formulários de colaboradores, unidades, gestores, medições, férias, avisos e usuários; nenhum formulário foi salvo em produção. Calendário e filtros retornaram os totais reais. Perfil e preferências carregaram com controles habilitados. Monitoramento consultou oito configurações ativas, revisão 1; a edição global carregou os valores reais de repetição 60s/10s e vigência, preservou tipo/destino e foi cancelada sem salvar, com console sem avisos ou erros. Advisors: Security sem erros, com um aviso de proteção contra senhas vazadas desabilitada no Auth; Performance sem erros ou avisos. A configuração Auth não foi alterada. As quatro páginas de Análises foram conferidas com dados reais: cobertura de extratos de 92,71%, 33 grupos na comparação por gestor e 17 pessoas afastadas ou em outras situações (4,43%). Mutações administrativas permanecem comprovadas pelos testes isolados, não por gravações fictícias no banco real.
