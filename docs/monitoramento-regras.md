# Regras do Monitoramento do CD

Versão inicial do motor: `monitoring-1.0.0`. O módulo `lib/monitoring/domain` é puro: não consulta banco, relógio do processo, interface nem diretórios. Reprocessamentos recebem os mesmos eventos canônicos, configurações e instante de referência e reproduzem o mesmo resultado. Monitoramento não altera Chamada Diária nem Banco de Horas.

## Instantes, jornada e intervalo oficial

Instantes são inteiros em milissegundos desde a época Unix. Offsets do arquivo devem ser preservados pela ingestão. O motor não corrige relógios automaticamente. A data operacional usa `America/Sao_Paulo` e corresponde à data local do início previsto da jornada, inclusive quando a saída ocorre no dia seguinte. O motor valida datas finitas e nunca arredonda antes de calcular.

Todos os intervalos são semiabertos: `[início, fim)`. Para as batidas 08:00, 12:00, 13:00 e 17:00, `W` contém 08:00–12:00 e 13:00–17:00: 480 minutos. O descanso oficial tem 60 minutos e não integra `W`. Seis batidas legítimas formam três períodos trabalhados quando a regra permite alternância. Para 22:00, 02:00, 03:00 e 06:00, a jornada permanece única: 420 minutos.

O primeiro registro do arquivo não define automaticamente a entrada. O contrato exige confirmação independente de início; atraso exige também confirmação de cobertura do início. A sequência sem natureza exige uma regra de alternância, independente do horário contratual. Papéis explícitos (`start`, `breakStart`, `breakEnd`, `end`) precisam ser conciliados e coerentes. Duas batidas sem natureza exigem autorização explícita de jornada sem intervalo e confirmação de fechamento. Não basta conhecer a duração contratual em horas.

Desde `monitoring-1.7.0`, a falta de horário padrão não bloqueia o trabalho observado em uma sequência fechada e coerente de quatro/seis batidas, com coleta integral declarada de todos os relógios vinculados. Sem escala para atribuir o dia operacional, exige-se também cobertura de 12 horas antes da primeira e depois da última batida, já decorridas, sem registros de datas vizinhas nessa margem. Essa proteção conserva como pendentes os turnos que podem atravessar a meia-noite. Escalas estimadas podem orientar a atribuição, mas não autorizam atraso, extra contratual ou lançamento no banco. Não se cadastra escala nem se preenche batida automaticamente; revisões explícitas de evidência, conflitos e períodos parciais continuam protegidos.

Estados da jornada: `empty`, `partial`, `ongoing`, `inconsistent` e `complete`. Uma saída ausente nunca é preenchida com 17:00 ou outro horário previsto. Em uma jornada parcial, pares já confirmados podem produzir duração parcial. Prolongar um período aberto exige confirmação explícita de andamento, cobertura de ponto até um instante declarado e referência de cálculo. O limite é o menor entre referência, cobertura e duração máxima da jornada. O fallback da biblioteca sem configuração persistida é 24 horas. O seed inicial da aplicação define 18 horas, e essa configuração vigente prevalece no adaptador.

## Localização, topologia e cobertura

Operação, refeitório e perímetro são dimensões separadas. O mapeamento validado informa portal, direção, classe aceita e efeitos explícitos em outras áreas. Exemplo: entrar no refeitório pode implicar estar fora da operação e dentro do CD, se a topologia cadastrada o confirmar. Nomes dos equipamentos não bastam para validar essa relação. A comparação de nomes e classes normaliza espaços, acentos e caixa, preservando o texto original. A classe usada pelo adaptador é o nome de evento original da exportação, com fallback para a classificação normalizada quando o nome não existe.

Estado inicial é desconhecido. Um evento anterior só ancora o estado quando fica dentro da janela configurada e existe cobertura contínua declarada. A janela é contada antes da entrada da jornada, não antes da margem de seleção de eventos. O fallback da biblioteca sem configuração persistida é 12 horas; o seed inicial da aplicação usa 3.600 segundos (1 hora). Eventos negados, alarmes não mapeados, anônimos, equipamentos sem mapa validado e ocorrências manuais sem justificativa não deslocam a pessoa. Uma batida de ponto também não prova entrada na operação.

Cobertura declarada deve representar todos os leitores necessários para observar aquela dimensão, com fontes, período e evidência. Entrada e saída da área devem estar mapeadas e validadas: declarar cobertura não substitui o leitor de saída ausente. Mínimo/máximo dos timestamps importados não representam cobertura contínua. Cada lacuna ou mudança do conjunto de fontes restaura o estado desconhecido até uma nova âncora. Pares exatos exigem continuidade de um mesmo conjunto declarado de fontes. Direções opostas simultâneas geram conflito; a ordem lexical dos eventos não resolve o estado. Repetir a mesma direção sem par torna o trecho anterior não confiável e gera pendência.

Dentro de `W`, o motor conserva exatamente: tempo dentro da operação + tempo fora da operação + tempo desconhecido = duração de `W`. Intervalos de uma mesma dimensão são disjuntos. A razão de cobertura é o tempo conhecido dividido por `W`. Quando apresentado, o percentual fora da operação deve usar como denominador o tempo conhecido, identificado explicitamente.

## Indicadores

- **Fora da operação:** interseção de estados conhecidos “fora” com `W`. A saída 11:50 e retorno 13:10 produzem 20 minutos, excluindo 12:00–13:00. Episódios distinguem entrada tardia na operação e saída após presença comprovada.
- **Refeitório:** exige entrada e saída elegíveis, com cobertura declarada. Preserva duração observada e interseção com `W`. Visita antes do ponto ou durante o descanso pode ter duração observada positiva e zero trabalhado.
- **Café:** interseção da visita com janelas configuradas e `W`. Janela ausente ou lista vazia gera valor ausente, nunca zero fictício. A classificação descreve visita em janela de café; não prova consumo de uma refeição. Visita pode ser anterior ao ponto, durante descanso, originada da operação ou sem entrada prévia comprovada na operação.
- **Sobreposição:** 15 minutos de café dentro de 20 minutos fora da operação permanecem dois indicadores sobrepostos. Nunca são somados como 35 minutos perdidos.
- **Fora do CD:** duração exata exige saída identificada do perímetro, reentrada identificada, mapa validado e cobertura contínua. Saída do torniquete seguida de Entrada Principal pode produzir apenas `interval-between-events`, com rótulo próprio. Botão anônimo não é saída individual.
- **Atraso:** primeira entrada confirmada menos início previsto, limitado inferiormente a zero. Conta somente quando estritamente maior que 900.000 ms. 08:15 para início 08:00 não conta; 08:16 conta, total 16 minutos, excesso 1 minuto; 08:15:01 também conta. Sem escala ou início confirmado, atraso é `null`, nunca zero fictício. A precisão da fonte não é aumentada artificialmente.

`Metric.milliseconds` é `null` quando não apurável ou excluído. `quality` distingue `complete`, `partial`, `unavailable` e `excluded`. `knownMs`, `unknownMs`, `coverageRatio` e intervalos explicam cada valor. Um número parcial é somente a parcela sustentada por evidência; não significa cobertura integral da jornada. Agregados mensais somam jornadas únicas, reportam elegíveis/excluídos/pendentes e não somam indicadores sobrepostos entre si.

## Repetições

Idempotência de arquivos/eventos é responsabilidade da ingestão e persistência. Supressão analítica não remove registros brutos nem substitui proveniência.

Padrões visíveis: ponto 60 segundos; acesso 10 segundos; versão `repetition-1.0.0`. A regra ancora a distância no evento mantido, sem cadeia móvel. Acesso exige pessoa, ponto, direção e classe compatíveis. Uma transição oposta invalida a âncora mesmo se ocorreu no outro leitor da mesma área. Entrada 10:00:00, saída 10:00:04 e entrada 10:00:08 permanecem três transições.

A configuração persistida inicial tem `kind=rule`, `target=global`, vigência a partir de 30/09/2026, repetição de ponto 60s, acesso 10s, estado anterior 3.600s, jornada máxima 18h e supressão de ponto sem natureza desabilitada. Configuração individual de regra, quando existente, prevalece sobre a global. Duas regras concorrentes do mesmo escopo deixam o processamento pendente de correção; a ordem de criação não escolhe uma silenciosamente. Os fallbacks da biblioteca só se aplicam quando nenhuma regra vigente é fornecida.

No ponto, papéis iguais explicitamente confirmados podem permitir supressão. Batidas próximas sem natureza são candidatas pendentes por padrão (`suppressUntypedPunches=false`). Administrador pode habilitar tratamento de ponto sem natureza, sob a regra configurada e confirmação de jornada. Papéis opostos nunca são suprimidos por proximidade. Toda supressão registra evento mantido, evento suprimido, distância, regra e versão.

## Elegibilidade e vigência

Escalas, mapas, grupos e exceções valem por data operacional, com início e fim inclusivos. Uma regra não muda no meio da jornada: a regra vigente no início vale também para a parte após a meia-noite. Correções exigem reprocessar as datas pertinentes, mantendo histórico das configurações e dos resultados.

Exclusões iniciais: grupos `COZINHA JK` e `LIDERANÇA JK`, exclusivamente para `outsideOperation`. A data de vigência deve ser explícita; o motor não inventa uma data histórica. Membros de grupos separados por vírgula são normalizados individualmente. Caminhos hierárquicos usam o nome da folha para a política: `Todos/CD/COZINHA JK` corresponde a `COZINHA JK`; o snapshot original permanece preservado. Snapshot atual não se aplica retroativamente.

Exceção individual tem precedência sobre regras de grupo. Entre grupos, exclusão prevalece sobre inclusão. Exceções individuais contraditórias ou snapshots históricos conflitantes deixam a elegibilidade pendente. Sem evidência histórica de grupos, uma política dependente de grupo também fica pendente. Excluir um indicador preserva pessoa, eventos, fotos e outros indicadores.

## Contrato e limites de integração

`calculateJourney(JourneyCalculationInput)` recebe uma única pessoa/jornada, eventos canônicos conciliados, observação e referência explícitas, escala opcional, evidências, mapas, cobertura, grupos e políticas. Retorna jornada, intervalos, indicadores, visitas, atraso, supressões e pendências. `assignPunchesToJourneys` distribui eventos em janelas explícitas; sobreposições ficam ambíguas. `aggregateJourneys` não duplica o mesmo resultado e rejeita versões conflitantes da mesma pessoa/data.

Arquivos reais ainda dependem de conciliação confiável RH–Defense–CPF/PIS, horários previstos, evidência de início/fim e declaração adequada de cobertura. Sem essas informações, importar dados não transforma o monitoramento em apuração completa. Resultado sintético de teste não representa homologação com dados reais nem implantação remota.

## Reprocessamento persistido

`lib/monitoring/reprocess.ts` valida o snapshot retornado pelo banco antes de adaptá-lo ao domínio. `reprocessMonitoringSnapshot` e seu alias `buildReprocessResults` recebem snapshot, solicitação e referência temporal explícita. O período é de no máximo 31 dias inclusivos. O adaptador não conserva CPF/PIS, nomes ou registros brutos dentro dos resultados calculados; conserva IDs de eventos e proveniência por arquivo/linha.

Para uma escala, a janela de seleção começa no ponto médio entre o fim previsto anterior e o início atual; termina no ponto médio entre o fim atual e o próximo início. Quando não há escala aplicável no dia vizinho, a mesma configuração serve apenas como limite temporal naquele dia vizinho. Essa convenção oferece margem para entradas antecipadas e saídas tardias sem separar turnos noturnos na meia-noite. Escalas que se sobrepõem são rejeitadas para conciliação. Seleção temporal nunca substitui a confirmação de natureza das batidas. Sem escala, a seleção por dia civil serve somente para mostrar pendências; não comprova uma jornada noturna.

Configurações de evidência pertencem à pessoa e à vigência operacional. Uma configuração atual não fornece evidência retroativa implicitamente. A fonte AFD deve ter `sourceIdentityConfirmed=true`: um fragmento sem identidade confirmada do relógio preserva os eventos, mas deixa a apuração indisponível mesmo quando existem confirmações de jornada. Batidas canônicas em conflito também bloqueiam o pareamento para evitar alteração silenciosa da paridade.

`POST /api/monitoring/reprocess` exige sessão aprovada ADMIN/RH, origem confiável, corpo limitado, UUID, motivo e período válido. Cada resultado grava a versão exata do snapshot; a RPC rejeita insumos alterados durante o cálculo. O servidor responde 409 para esse conflito, incluindo quantos dias já foram salvos. Um novo processamento atualiza resultados ativos com histórico. Nenhum segredo de ingestão é enviado ao navegador.

O worker usa `POST /api/monitoring/ingest/reprocess` com credencial de ingestão e lista de fontes autorizadas. A requisição reivindica até dez jobs. Cada job usa lease e a versão dos insumos; a finalização grava resultado, histórico e retira o job da fila. Resultado legitimamente indisponível também conclui o job, sem repetição infinita por falta de escala ou identidade. Falhas liberam uma nova tentativa após o intervalo da fila, com código sanitizado. A resposta ao processo local contém somente contagens, sem devolver colaboradores ou eventos. O resumo `quality=excluded` identifica exclusão do indicador principal fora da operação; a qualidade e elegibilidade dos demais indicadores continuam independentes no resultado detalhado.

## Validação local do motor

Executar `pnpm exec vitest run lib/monitoring/domain lib/monitoring/reprocess.test.ts app/api/monitoring/reprocess/route.test.ts app/api/monitoring/ingest/reprocess/route.test.ts`. A suíte cobre os exemplos numéricos, os limites de atraso, pausas, jornada noturna, seis batidas, dados parciais, topologia, cobertura, conflitos, vigências, exclusões, adaptação de snapshot, proveniência, fonte não confirmada, validação HTTP, allowlist, lease e CAS. Cem cenários sintéticos adicionais e um cenário de 12 mil transições verificam conservação e intervalos disjuntos sem usar dados pessoais reais.

O teste `seed-integration.test.ts` aplica todas as migrations em PGlite descartável, consulta o snapshot SQL real e executa o adaptador. Verifica os parâmetros globais do seed, mapeamentos, perímetro sem saída e agregado SQL autenticado. Uma pessoa excluída de fora da operação continua no numerador e denominador de atraso quando esse indicador é elegível e apurável.

## Chamada preenchida pelo ponto e revisão do gestor

A migration `20261017175802_daily_call_punch_workflow.sql` liga a apuração à Chamada por transação: `monitoring_save_result` e a finalização de jobs executam `daily_call_apply_import` antes do commit. Erro preserva o job para nova tentativa. A função confere a versão de entrada, a identidade, a escala, a fonte e o saldo diretamente no banco; não recebe um status proposto pelo navegador. A origem de cada lançamento é `punch`, `automatic_absence` ou `manual`.

Uma batida canônica autorizada, elegível, sem conflito, em fonte AFD com identidade confirmada e vínculo único vigente, comprova `P`. Não é necessário inventar quatro batidas para reconhecer presença. Namespaces compartilhados explicitamente configurados usam a mesma conciliação do monitoramento. Escalas noturnas usam janelas operacionais entre os pontos médios das jornadas vizinhas. Sem escala, uma batida pode comprovar presença no dia civil, sem comprovar uma jornada completa. Admissão desconhecida ou posterior ao dia e situação fora de ATIVO/NOVO_ADMITIDO impedem automação.

Sem ponto, `I` significa falta injustificada; `F` continua significando folga. `I` automático exige dia anterior ao atual, escala vigente única com trabalho previsto, jornada encerrada e cobertura de ponto comprovada em toda a janela operacional. Cada fonte AFD ligada à identidade deve declarar `declaredCoverage.continuous=true` com limites explícitos, ter importação completa posterior ao fim da janela e não ter arquivos incompletos, rejeições ou conflitos. Uma tentativa de leitura/parsing com falha impede ausência até existir importação completa do mesmo caminho posterior à falha. Estado `error` também impede ausência; estar offline hoje, isoladamente, não revoga uma cobertura histórica comprovada. Uma falha sem intervalo confiável não é descartada como irrelevante só por ter acontecido depois do dia analisado. Arquivo corrigido já checkpointado pode exigir reprocessamento explícito para registrar a recuperação; heartbeat saudável sozinho não resolve a tentativa.

Saldo vigente de até 480 minutos, incluindo exatamente 480, zero e negativo, permite `I` quando as demais evidências são suficientes. Acima de 480 minutos, a Chamada fica em branco, na fila do gestor; não há `G` automático. Sem medição vigente, fica pendente. O Banco de Horas atual consome compensações `G` em dias calculados a partir da jornada, com arredondamento; ele não fornece um saldo restante exato em minutos. Se já existe `G` no ciclo, a falta automática fica bloqueada por `BALANCE_REQUIRES_RECONCILIATION` até nova medição vigente, sem inventar um débito de 480 minutos.

Ponto tardio pode corrigir `I` automático para `P`. Ponto, nova cobertura ou reprocessamento não sobrescrevem status manual, férias/folgas manuais ou limpeza manual. Confirmar um mesmo status automático pela tela comum também registra intenção manual. Retração de evidência pode retirar somente um lançamento automático. Decisões e mudanças ficam em auditoria; repetições com os mesmos dados não duplicam lançamentos.

`daily_call_workflow('queue', ...)` retorna linhas paginadas, totais e dias/equipes agregados em todo o período de até 31 dias. Perfis aprovados ADMIN/RH/LEITURA veem o escopo permitido; GESTOR vê apenas sua equipe atual. `resolve` exige perfil de escrita, versão da decisão, timestamp do lançamento e motivo. `close` exige revisão atual e todas as pendências resolvidas; apenas registra a revisão do dia, sem aplicar `G` ou `I` implicitamente. Fechamentos usam uma impressão dos dados daquela data/equipe: uma alteração em outra equipe não reabre o dia. Mudança relevante no próprio dia reabre a revisão.

Dias sem eventos entram na fila do worker pela interseção explícita entre cobertura declarada, vínculo, admissão e escala. Mudanças de configuração de fonte, conclusão de importação, medição de saldo e `G` manual posterior também reavaliam os dias afetados. O intervalo declarado pode gerar mais de 31 jobs; cada job processa uma pessoa/dia, em lotes de até dez. Não se infere cobertura pelos extremos dos eventos, nem se gera falta de arquivo fragmentado.

Bloqueios apresentados: admissão desconhecida, dia anterior à admissão, situação não ativa, escala ausente/conflitante/sobreposta, dia aberto, cobertura de ponto não comprovada, identidade ambígua, saldo desconhecido, saldo com compensações por conciliar e reprocessamento ainda pendente. A suíte `daily-call-integration.test.ts` valida a migration real, permissões, CAS, fronteira 480/481, presença tardia, preservação manual, noite, namespace, cobertura falha, fila e fechamento. São dados sintéticos em PostgreSQL descartável, não evidência de homologação operacional remota.

## Compatibilidade com proteção de atualização do Supabase

A migration corretiva `20261017185924_monitoring_safeupdate_compat.sql` acrescenta `WHERE id=true` aos dez incrementos das tabelas singleton de revisão. Ela preserva as migrations anteriores e redefine somente nove funções, mantendo OIDs, permissões e configurações. A aplicação confere as assinaturas e a quantidade exata de comandos antes de alterar cada definição; uma base diferente ou repetição aborta a correção. Não desabilita `safeupdate` e não usa predicados genéricos como `WHERE true`.

`safeupdate-compat.test.ts` audita as definições finais de todas as funções da aplicação, distingue um `WHERE` externo de um filtro presente apenas em subconsulta e verifica que nenhum `UPDATE`/`DELETE` permanece sem predicado real. O PGlite não carrega a extensão `safeupdate`: os testes comprovam a estrutura SQL e as regressões funcionais; a ausência do erro `21000` na RPC do Supabase precisa ser conferida no destino.
