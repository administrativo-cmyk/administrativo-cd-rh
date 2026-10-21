# Histórico privado e janela de três ciclos de folha

O projeto é `administrativo-cd-rh` (`kqgtnucqxqqgwdyvhvdd`). A política revisada em 21/10/2026 mantém o **ciclo atual da folha e os dois anteriores**, sempre do dia 21 ao dia 20, pela data de São Paulo. Em 21/10 ficam os ciclos 21/08–20/09, 21/09–20/10 e 21/10–20/11. A data operacional inicial é 21/08/2026; eventos de 20/08 também permanecem para proteger jornadas noturnas.

No dia 21/11, o início da janela passa automaticamente para 21/09. O ciclo 21/08–20/09 é copiado e verificado no histórico privado antes de sair do banco operacional. A virada depende do agendamento na nuvem, sem precisar manter um computador ligado. A rotina usa páginas limitadas, portanto a limpeza completa pode levar algumas rodadas. Os arquivos originais não são apagados.

Os arquivos AFD originais continuam preservados. Nenhum plano pago é contratado automaticamente. Banco, Storage e transferência possuem quotas distintas. O orçamento da aplicação é 800 MiB de Storage no projeto; a ingestão pausa antes de o banco alcançar 470 MiB. Esses limites não ampliam as quotas do provedor.

## Integridade e acesso

O bucket `monitoramento-historico` é privado, inclusive diante de políticas antigas permissivas. Somente o servidor acessa os objetos. Cada objeto gzip tem SHA-256 comprimido e descomprimido; o upload é imutável e precisa ser relido antes de registrar a prova no catálogo.

Antes da redução inicial, a manutenção congela as 18 tabelas do Monitoramento e pausa seu agendamento. O snapshot contém linhas reais, fotos, configurações, vínculos, planos, lotes, filas e auditoria. O manifesto só é selado depois de exportar todas as linhas e conferir novamente os objetos publicados. A Chamada Diária, as correções de RH e o Banco de Horas não entram na reconstrução.

A reconstrução limita-se a `monitoring_events`, `monitoring_occurrences`, `monitoring_results` e `monitoring_jobs`. Um segundo manifesto identifica o conjunto operacional a restaurar. O servidor exige snapshot selado, contagens originais estáveis, cópia operacional conferida e ausência de dependências externas antes de liberar espaço. A restauração usa os mesmos identificadores e compara cada linha; respostas perdidas podem ser repetidas. A ativação exige todas as contagens conferidas e banco abaixo de 450 MiB.

As ocorrências AFD mantêm proveniência compacta no banco. Referências repetidas ao mesmo ponto são arquivadas, preservando a referência canônica e os originais; reexportações idênticas não recriam essas cópias. As ocorrências de acesso Defense mantêm identidade, nome, grupos e erros necessários à detecção de mudanças. Os cadastros Defense e eventos canônicos continuam completos. As células originais repetidas ficam preservadas no histórico.

A consulta individual primeiro passa pela autorização existente do histórico. Só depois o servidor combina os relógios e devolve batidas da identidade e vigência vinculadas àquela pessoa. A chave privada, documentos de outras pessoas e caminhos internos não chegam ao navegador. Falha de integridade interrompe a leitura; não vira ausência de batidas.

## Importação e manutenção recorrente

O índice histórico guarda NSR por relógio, documento, instante, precisão, hash e origem. Reexportar todo o período não duplica batidas. NSRs de relógios diferentes permanecem independentes; a reunião por colaborador acontece na apuração. Divergências reais são sinalizadas, sem substituir silenciosamente o registro canônico.

Antes de gravar um AFD novo, o worker verifica seu original e índice na nuvem. Batidas anteriores à janela ficam arquivadas; as recentes entram no banco. Plano, cursor, hashes e concessão dos envios iniciados permanecem válidos. O histórico de envios informa separadamente as linhas arquivadas.

A manutenção usa o agendamento e os tokens descartáveis já existentes na nuvem. Copia páginas de até 500 linhas vencidas ou referências redundantes, relê os hashes e só então remove a página exata. Alteração concorrente invalida a remoção. Inclui eventos antigos, sua proveniência, versões substituídas de resultados e auditoria antiga. Nenhum arquivo original é removido. A rotina também executa quando não há novos envios. O VACUUM diário permite reutilizar espaço das tabelas operacionais.

Observar batidas em um arquivo não comprova cobertura completa. A importação não amplia a cobertura declarada, não cria faltas retroativas e não altera a base do Banco de Horas. Turnos noturnos, descanso, três batidas pendentes, afastamentos e decisões manuais continuam protegidos.

## Operação e recuperação

Credenciais ficam somente no ambiente do servidor. Saídas privadas ficam em `artifacts/`, ignorado pelo Git. Os comandos verificam explicitamente o projeto e não sobrescrevem objetos.

```powershell
pnpm monitoring:archive:cloud state --project kqgtnucqxqqgwdyvhvdd --dir artifacts/recuperacao
pnpm monitoring:archive:cloud begin --project kqgtnucqxqqgwdyvhvdd --dir artifacts/recuperacao
pnpm monitoring:archive:cloud export --project kqgtnucqxqqgwdyvhvdd --dir artifacts/recuperacao
pnpm monitoring:archive:cloud seal --project kqgtnucqxqqgwdyvhvdd --dir artifacts/recuperacao
node --env-file=.env.local --experimental-strip-types scripts/monitoring-archive-index.ts --project kqgtnucqxqqgwdyvhvdd --archive artifacts/pacote-afd --dir artifacts/recuperacao
node --env-file=.env.local --experimental-strip-types scripts/monitoring-archive-rebuild.ts prepare --project kqgtnucqxqqgwdyvhvdd --dir artifacts/recuperacao
```

Os comandos `start`, `restore` e `activate` do script de reconstrução são etapas separadas, protegidas pelo manifesto e executadas apenas numa manutenção autorizada. Não iniciar outra reconstrução durante um envio ativo. Após interrupção, consultar `state` e retomar a mesma execução, mantendo diretório, arquivos e identificador.

O utilitário local `pnpm monitoring:archive` continua disponível para preparar, verificar, reconciliar e restaurar originais. A janela operacional e os novos manifestos usam os mesmos três ciclos de folha. Manifestos anteriores permanecem imutáveis e documentam a política vigente quando foram criados.

Ativação concluída exige: cópia privada publicada e relida, banco medido abaixo do limite, consulta por papel funcionando, scheduler ativo e ambos os envios completos e reconciliados. Build e testes locais, isoladamente, não comprovam esses resultados.

Referências: [tamanho do banco](https://supabase.com/docs/guides/platform/database-size), [quota de Storage](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size) e [transferência](https://supabase.com/docs/guides/storage/serving/bandwidth).
