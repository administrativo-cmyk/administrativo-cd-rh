# Horário padrão do colaborador

O painel do colaborador, aberto pela foto/nome no Quadro Atual ou na Chamada, mostra o horário vigente na data consultada. ADMIN/RH e o GESTOR da própria equipe podem cadastrar ou alterar o horário, com justificativa e início da vigência. A edição preserva o período anterior, registra auditoria, invalida apurações afetadas e usa versão para impedir sobrescritas concorrentes. Alterações de GESTOR geram avisos internos separados para ADMIN e RH.

Parâmetros informados pela operação:

| Equipe | Horários | Dias |
|---|---|---|
| Operação, Refeitório, Conservação | 06:00–14:20; 10:00–18:20; 14:00–22:20; 22:00–06:20 | Diurno: segunda a sábado. Noturno: domingo a sexta, com um domingo de folga por mês |
| APP | 07:00–19:00; 19:00–07:00 | 12×36, com data de plantão de referência |
| Administrativo | 08:00–18:00 | Segunda a sexta |
| Jovens | 08:00–14:15; 11:00–17:15 | Segunda a sexta |
| Menor | 08:00–12:00 | Segunda a sexta |
| Manutenção | 08:00–16:20 | Segunda a sábado |

Todos os padrões descontam **60 minutos de almoço da carga prevista**. O trabalho realizado continua sendo calculado pelos pares de batidas, sem inventar um intervalo ou descontá-lo duas vezes. Tempo extra é a diferença positiva entre trabalho confirmado e carga prevista. Essa comparação não lança créditos no Banco de Horas.

O turno noturno pertence à data da entrada: sexta 22h até sábado 06h20 é sexta. As janelas de atribuição usam limites intermediários entre jornadas vizinhas; o encerramento após meia-noite não cria presença no dia seguinte. APP usa paridade de datas, inclusive na mudança de mês. Exceções de calendário confirmadas têm prioridade.

O domingo mensal do noturno precisa de uma data por mês. Sem a data, domingos desse mês ficam pendentes para falta automática. Batidas reais continuam produzindo presença. A edição permite informar o domingo no mês da nova vigência e preserva as datas de outros meses.

## Seleção inicial pelas batidas

`scripts/analyze-clock-schedule-patterns.mjs` analisa os dados privados exportados em `artifacts/clock-reconciliation`. Seleciona o padrão mais frequente compatível com função/setor, com pelo menos três jornadas utilizáveis e predominância mínima de 50%; empates ou horários incompatíveis ficam para revisão. Os limites analíticos de proximidade não são tolerâncias de atraso. APP exige pelo menos quatro plantões da mesma paridade distribuídos por seis dias para preencher a referência do ciclo.

A amostra declarada completa é **01–12/10/2026**. **13/10 é parcial**, excluído da inferência. O analisador desta amostra suporta explicitamente o fuso brasileiro de 2026 e recusa outros anos. Os relatórios com nomes e matrículas permanecem ignorados pelo Git.

`scripts/prepare-clock-default-schedules.mjs` gera SQL revisável, sem conexão ou credenciais. Verifica a integridade da amostra, os cadastros, a identidade dos relógios e a cobertura declarada. Não sobrescreve horários existentes. O ensaio usa rollback; a aplicação usa o mesmo RPC auditado da tela e pode ser repetida sem duplicar cadastros.

## Limites da apuração

Horário esperado não comprova início ou fim de jornada. O motor aceita confirmação explícita ou uma sequência alternada não ambígua de quatro/seis batidas, em janela inteiramente coberta pela coleta integral declarada de **todos** os relógios vinculados. Fonte não confirmada, conflito, coleta parcial ou batidas incompletas impedem esse fechamento automático. As áreas do Defense continuam exigindo mapa e cobertura próprios.

Sem batida, a falta automática exige dia de trabalho confirmado, coleta completa, identidade válida e saldo conhecido até 8h, além das demais proteções existentes. Saldo acima de 8h fica para o gestor. Edições manuais da Chamada são preservadas. Horários ainda estimados e o domingo mensal pendente não autorizam falta automática.
