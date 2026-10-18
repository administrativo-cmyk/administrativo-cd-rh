# Interface de Monitoramento — validação local em 17/10/2026

Implementação em `app/monitoramento/page.tsx` e `components/monitoring/`, mantendo o padrão visual administrativo. A página exige perfil aprovado; dados vêm das APIs/RPCs de Monitoramento. Falha inicial apresenta erro, sem dados fictícios em produção.

## Fluxos entregues

- Consulta por período, atalho mensal, colaborador/matrícula, unidade, gestor, grupo, escala e qualidade. Filtros aplicados governam tabela, paginação e CSV; editar campos não altera silenciosamente a consulta já exibida.
- Indicadores distinguem zero, parcial, pendente, excluído, desatualizado e não apurável. Exibem denominadores, trabalho apurado, tempo desconhecido e instante da consulta em America/Sao_Paulo.
- Drawer seleciona UUID e data operacional. Carrega apuração do dia e eventos paginados do período; trocar dia reinicia a página de eventos. Mostra trabalho/descanso, métricas com cobertura, atraso total/excedente, visitas ao refeitório, episódios fora da operação, estados por área e proveniência com ID do evento, arquivo e linha.
- Trecho provisório é identificado como parte da apuração parcial; janela de café ausente aparece como “Janela não cadastrada”. Intervalos operação/principal não são apresentados como prova de tempo fora do CD.
- ADMIN/RH acessam Importação, Conciliação e Configuração. Importação mostra heartbeat, último sucesso, fila de recálculo, contadores dos arquivos e tentativas com falha. Ausência de sinal por 120 segundos exige conferir o processo local.
- Conciliação inclui cadastros Defense sem eventos, fotos pendentes, ambiguidades e identidades sem vínculo. Selecionar outra identidade limpa pessoa/evidência anteriores. Vincular exige seleção explícita do colaborador, vigência e evidência; falha mantém o rascunho.
- Configurações têm formulários para leitores, escalas, políticas, cobertura, regras globais, conta/foto, grupos, confirmação de jornada e evento manual. Revogação exige justificativa e preserva histórico. Mudanças entram na fila automática; detalhe permite recálculo pontual com motivo.
- Avatar reutilizável consulta foto privada e mantém iniciais quando indisponível. Integrado ao cabeçalho, Monitoramento, Chamada, Quadro Atual e Banco de Horas.

## Evidência executada

- `npx vitest run components/monitoring/monitoring-app.test.tsx`: 11 testes passaram. Cobrem restrição dos controles administrativos, filtro/exportação aplicada, falha com dados anteriores, UUID+data, paginação ao mudar dia, fevereiro bissexto, regras no alvo global, heartbeat, vínculo com zeros e rascunho preservado, troca de identidade e fallback de foto.
- `npm run typecheck`: passou.
- ESLint dos componentes, página, avatar e harness: passou.
- `node scripts/monitoring-visual.mjs`: Playwright/Chrome sobre componentes reais, servidor loopback e fixtures inteiramente sintéticas. Executado em 1440×1000 e 390×844, sem erros de página nem overflow do documento, com rascunho preservado após conflito simulado.
- Capturas em `artifacts/monitoring-visual/`: consulta, detalhe, importação, conciliação e configuração nos dois tamanhos. `results.json` registra os resultados. Captura do drawer aguarda conteúdo e conclui animações antes do screenshot.

O harness não altera autenticação da aplicação, não utiliza banco remoto e não comprova autorização/funcionamento em sessão real. A API e o banco têm testes próprios no relatório geral. Repetir aceite autenticado em homologação após aplicação autorizada das migrations e configuração das fontes.

Defaults do formulário de regras refletem o seed (estado anterior de 1 hora, jornada máxima de 18 horas). Os fallbacks conservadores do motor são documentados separadamente. Módulos antigos ainda sem implementação constam em `docs/monitoramento-correcoes.md`.
