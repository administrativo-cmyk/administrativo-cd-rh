# Importação recorrente do Monitoramento

Gestão de fontes pela tela, revisão de vínculos e importação com prévia: [operações administrativas](MONITORAMENTO_OPERACOES_REVISAO.md). A documentação distingue código local e ativação do banco conectado.

## Limites e destino

O worker executa na máquina que possui as pastas. O site hospedado não lê o disco do Windows. A execução padrão é `dry-run`: lê e valida os arquivos, mas não grava banco, fotos, checkpoints nem solicita reprocessamento.

O modo `--apply` envia lotes para a API autenticada configurada. O worker usa somente `MONITORING_INGEST_TOKEN`; a credencial privilegiada do banco permanece no servidor. O destino deve usar HTTPS ou loopback HTTP. Redirecionamentos, credenciais na URL e parâmetros de URL são recusados.

Nenhuma publicação, migration remota ou importação em produção foi executada nesta validação. As importações persistidas descritas abaixo ocorreram em PGlite descartável em memória, sem URL de banco, sem credenciais remotas e sem diretório persistente.

## Instalação e configuração no Windows

Use a versão Node exigida pelo `package.json` e as dependências locais já instaladas. Não é necessário instalar um serviço global.

1. Copie `monitoramento.example.json` para `monitoramento.local.json` na raiz do projeto.
2. Revise as pastas existentes, os IDs estáveis de fontes e o destino da API.
3. Configure o mesmo token restrito no processo servidor e no ambiente do worker. No servidor, configure `MONITORING_INGEST_SOURCE_IDS` com os IDs permitidos. Não coloque segredos no JSON, Git, comandos registrados ou frontend.
4. Execute a validação sem gravação antes de habilitar a persistência.

```powershell
Set-Location 'D:\PROJETOS\INDICADOR CD FACIAL'
Copy-Item -LiteralPath 'monitoramento.example.json' -Destination 'monitoramento.local.json'
node --experimental-strip-types scripts/monitoring-import.ts --config monitoramento.local.json --dry-run
```

Execução única com o token já disponível no ambiente:

```powershell
node --experimental-strip-types scripts/monitoring-import.ts --config monitoramento.local.json --apply --once
```

Acompanhamento contínuo:

```powershell
node --experimental-strip-types scripts/monitoring-import.ts --config monitoramento.local.json --apply --watch
```

`Ctrl+C` encerra o worker sem marcar lotes pendentes como concluídos. No Agendador de Tarefas do Windows, use o caminho absoluto de `node.exe`, os argumentos acima com caminhos absolutos, a pasta do projeto como diretório inicial e uma conta que tenha acesso às pastas. Configure reinício após falha. O token deve vir do ambiente seguro dessa conta/processo. O trabalho atual não instala nem inicia automaticamente uma tarefa agendada.

## Pastas e fontes

O exemplo aponta para as pastas existentes:

| Fonte estável | Pasta | Perfil |
| --- | --- | --- |
| `ponto-legado-cd-jk` | `relogio de ponto` | AFD legado de 38 caracteres |
| `ponto-iso-cd-jk` | `relogio de ponto` | AFD ISO de 50 caracteres |
| `defense-access-cd-jk` | `ACESSOS DEFENSE/Registros de Acesso-2026-10-16-14-54-31` | AccessRecords XLSX |
| `defense-person-cd-jk` | `ACESSOS DEFENSE/Informações Pessoais-2026-10-16-16-45-12` | Person XLSX e imagens |

As duas fontes Defense usam `identityNamespace: defense-cd-jk`. Isso permite correspondência exata entre seus IDs textuais sem tratá-los como matrícula, CPF ou PIS. Não há conciliação automática por nome nem criação de contas.

Os AFDs atuais não têm cabeçalho nem trailer. O nome do arquivo não define a identidade do relógio. A seleção pelo perfil permite ler os dois equipamentos atuais na mesma pasta, mas **não distingue dois relógios diferentes que produzam o mesmo perfil**. Antes de acrescentar outro equipamento com o mesmo perfil, use outra pasta e outro ID estável. Confirme fisicamente cada relógio e registre `sourceIdentityConfirmed: true` somente após essa validação. Os exemplos permanecem `false`.

Mantenha o mesmo ID de fonte quando apenas o arquivo for renomeado ou a pasta for transferida. Um ID novo produz uma fonte nova. Não altere o namespace para vincular pessoas sem evidência.

## Contratos de leitura

- Hash SHA-256 e parser recebem o mesmo `Buffer` imutável. O arquivo original nunca é alterado.
- A varredura aguarda estabilidade de tamanho, alteração, inode e criação; confere novamente após abrir e após ler. Uma alteração detectada gera tentativa pendente. Estabilidade é uma verificação operacional, não prova de cobertura completa de uma exportação fragmentada.
- XLSX: percorre as linhas realmente presentes e ignora `dataValidations`/`extLst` com ExcelJS. Não usa a dimensão declarada como limite. A primeira pessoa da linha 4 é preservada.
- O diretório ZIP é validado antes da leitura. Há limites de bytes comprimidos, expansão declarada e expansão real, entradas, linhas e profundidade. Arquivos truncados, macros e caminhos ZIP inseguros são recusados. Fórmulas não são executadas nem usadas como identificadores.
- CPF e PIS têm validação distinta de dígitos verificadores. Só um zero de preenchimento explicitamente permitido pelo leiaute de 12 posições é removido. Não há truncamento genérico. IDs Defense permanecem textuais, inclusive zeros iniciais.
- AFD legado usa o fuso configurado e precisão de minuto. AFD ISO respeita o offset explícito de cada registro. UTF-8 inválido é rejeitado; o perfil legado pode usar ISO-8859-1. CRC fica `not_verified` até existir especificação confiável da família do REP.
- Um último registro de batida com comprimento menor que o perfil gera `AFD_INCOMPLETE_LAST_RECORD`; a tentativa fica pendente e o arquivo não é concluído.
- Tipos AFD 5 e 6 são preservados como ocorrências sem criar batidas. O CPF do responsável em alterações cadastrais não é usado para ligar colaboradores.
- Acessos mantêm a coluna Entrada/Saída como proveniência; a coluna não define a direção física. Somente desbloqueios faciais identificados e autorizados são elegíveis para transição. Botão, abertura remota, estranho, negação e alarme não deslocam uma pessoa.
- Grupos são conjuntos separados por vírgula. `groups` guarda os nomes normalizados das folhas; `groupPaths` e a célula original preservam a hierarquia. Um snapshot atual não é aplicado retroativamente como histórico comprovado.

## Idempotência e proveniência

Arquivo: fonte + SHA-256 dos bytes + versão do parser. Ocorrência: fonte + arquivo + aba + linha. AFD: evento canônico por fonte estável + NSR. Mesmo NSR com conteúdo divergente gera conflito e não sobrescreve silenciosamente o evento.

Defense usa ID nativo quando disponível. Na amostra, usa impressão digital normalizada de fonte, identidade, equipamento, instante, classe/evento, ambiente e tipo de ponto. Nome e grupo mutáveis ficam na proveniência e não criam outra passagem.

Sem ID nativo, ocorrências indistinguíveis representam equivalência de exportação, sem provar que são o mesmo fato físico. A política inicial é **um evento canônico por impressão digital, todas as ocorrências preservadas**, incluindo multiplicidade por arquivo. A supressão analítica de batidas próximas pertence ao motor temporal e é uma camada diferente.

Os lotes têm até 500 ocorrências. A conclusão exige todas as ocorrências esperadas e confirmação explícita de conclusão pelo servidor. O worker não grava checkpoint apenas porque a última requisição retornou HTTP 200: exige `fileStatus: complete` ou `conflict`. Unicidade, disputa e transação são responsabilidade da RPC do banco. O checkpoint local guarda somente hashes, versões e horários; ele é um cache de progresso. A perda desse checkpoint pode causar reenvio, mas não autoriza duplicação no banco.

## Fotos

As referências locais do Person são resolvidas somente na raiz autorizada. URL, caminho absoluto, travessia, link simbólico e referência ambígua são recusados. Não há download de hyperlinks. Os bytes são decodificados, limitados em pixels e convertidos em JPEG de até 320 × 320, com orientação aplicada e metadados descartados.

As fotos seguem um checkpoint independente. Uma imagem que chegar ou mudar depois do Person concluído é processada na próxima varredura. Miniaturas com o mesmo hash não são reenviadas. Ausência de imagem mantém o cadastro e produz pendência/fallback; não bloqueia a importação de eventos.

## Recuperação e reprocessamento

```powershell
# Retoma arquivos sem conclusão; --resume é explícito, mas já é o padrão.
node --experimental-strip-types scripts/monitoring-import.ts --config monitoramento.local.json --apply --resume

# Reapresenta snapshots e fotos; o banco mantém a idempotência.
node --experimental-strip-types scripts/monitoring-import.ts --config monitoramento.local.json --apply --reprocess --source ponto-iso-cd-jk --from 2026-10-01 --to 2026-10-17
```

O filtro de período seleciona arquivos que intersectam o intervalo com margem de 36 horas. O arquivo é enviado inteiro para preservar seu hash e dar contexto a jornadas noturnas. O filtro não comprova cobertura contínua.

O modo `--watch` combina notificações do sistema de arquivos e varredura periódica, inicialmente a cada 30 segundos. Falhas por arquivo são registradas na API com código e caminho relativo, sem conteúdo pessoal. O heartbeat também registra fontes vazias. Falhas de conexão permanecem visíveis no resumo local; o worker tenta novamente na próxima varredura.

Ao terminar cada varredura em modo `--apply`, o worker solicita reprocessamento ao servidor em lotes de até 10, limitado a 1.000 trabalhos por varredura. Isso ocorre mesmo sem arquivos novos, pois conciliações e configurações podem gerar pendências. O restante permanece na fila do servidor. O processo local envia arquivos e solicita o processamento; o servidor calcula os indicadores e sincroniza a Chamada na mesma transação da apuração. Ponto válido conciliado pode gerar `P`; ausência comprovada em dia encerrado, com saldo vigente até 480 minutos, pode gerar `I`. Saldo superior a 480 minutos permanece em branco para decisão do gestor. Lançamentos e limpezas manuais são preservados. O Banco de Horas mantém sua lógica existente; não existe débito automático novo de oito horas. Os critérios completos de evidência e os bloqueios estão em [monitoramento-regras.md](monitoramento-regras.md).

## Evidências locais de 17/10/2026

| Entrada | Linhas/ocorrências | Eventos ou pessoas | Identidades |
| --- | ---: | ---: | ---: |
| AFD legado | 668 | 656 batidas | 79 PIS |
| AFD ISO | 10.232 | 10.212 batidas | 316 CPF |
| AccessRecords | 34.464 | 34.398 equivalências canônicas | 304 IDs Defense |
| Person | 353 | 353 pessoas | 353 IDs Defense |

Todos os registros de batida foram aceitos. Os AFDs têm 32 registros adicionais, dos tipos 5/6. Os acessos têm 66 ocorrências adicionais indistinguíveis; isso não significa 66 passagens faciais duplicadas. Há 15 IDs Person com zero inicial, 299 referências de foto e 299 arquivos decodificados com sucesso. As outras 54 pessoas não têm referência. Não houve falha ou linha rejeitada no dry-run.

Foram encontradas 303 correspondências Defense exatas, um ID órfão nos acessos e 50 pessoas Person sem acesso no período. Os grupos hierárquicos incluem 16 pessoas em COZINHA JK e 29 em LIDERANÇA JK, com uma interseção de uma pessoa. Nenhum desses dados foi unido automaticamente a RH/CPF/PIS.

Validação persistida descartável:

```powershell
node --experimental-strip-types scripts/monitoring-local-validation.ts --synthetic
node --experimental-strip-types scripts/monitoring-local-validation.ts --real --config monitoramento.example.json
```

O modo `--real` aplicou 19 migrations no PGlite em memória e persistiu quatro arquivos, **45.266 eventos**, **45.717 ocorrências**, **353 snapshots/pessoas**, **299 fotos**, zero vínculos RH inventados, zero arquivos incompletos e zero conflitos na amostra. Segunda carga e reapresentação com nomes diferentes mantiveram as contagens. Interrupção entre lotes, retomada, conflito de NSR, alteração do tamanho de lote nas duas direções e chamadas simultâneas serializadas foram verificados com dados sintéticos. A fila foi validada quanto à criação após vínculo sintético, escopo de fontes, lease exclusivo, rejeição de lease inválido e recuperação após falha. Esses vínculos sintéticos foram criados somente na etapa de teste, separados das contagens da amostra. PGlite com uma conexão não substitui prova de concorrência PostgreSQL com múltiplas conexões.

Na execução mais recente: ingestão SQL 26.956 ms; segunda carga e renomeio 3.491 ms; total 60.084 ms, incluindo leitura, migrations, fotos e testes de recuperação; RSS observado 1.123 MiB. Esses números descrevem esta execução local, não SLA de produção.

Benchmark somente sintético, sem arquivos persistidos:

```powershell
node --experimental-strip-types scripts/monitoring-benchmark.ts
node node_modules/vitest/vitest.mjs run test/monitoring-ingestion.test.ts
```

Foram lidos 40.000 acessos em 4.649 ms e 12.000 batidas AFD em 662 ms. RSS observado: 714 MiB, incluindo geração e leitura do XLSX no mesmo processo. A suíte dirigida tem 36 testes e inclui dimensionamento incorreto do XLSX, validação extensa, horário ambíguo, identidade, retomada, confirmação de conclusão, fotos tardias e limite da fila.

Permanecem dependentes de evidência externa: identidade física dos relógios sem cabeçalho, correspondência confiável RH–Defense–CPF/PIS, horários previstos, cobertura contínua e saída identificada do perímetro. As fotos locais já foram encontradas e verificadas; não são mais uma ausência geral da amostra.

### Verificação da fonte RH local

Foi procurada uma fonte confiável adicional na raiz, em `data`, `data/private`, `contexto-importado` e na pasta temporária de importação existente. `data/private` contém somente `.gitkeep`; não foram encontrados arquivos XLSX, XLS ou CSV de RH nesses locais. A pasta temporária está vazia. O contexto importado contém continuidade, histórico de conversa, imagens e hashes dos AFDs, sem uma planilha de correspondência.

O contrato do importador RH existente (`lib/hr-import/pipeline.ts`) usa Chapa/Matrícula, nome, filial, setor, função, situação, admissão, gestor, duração da jornada, saldo e informações de férias. Não inclui CPF, PIS, ID Defense ou horário previsto de início. A tabela `colaboradores` identifica matrícula; o CPF de `perfis` identifica a conta de login e, sozinho, não comprova vínculo com um colaborador. A ausência dessa correspondência foi verificada no material local, sem consultar ou alterar dados remotos e sem tentar união por nome.

### Conferência assistida e fotos — revisão de 17/10/2026

A tela de Conciliação permite ver a foto Defense antes do vínculo por uma rota separada, `/api/monitoring/identity-photo`. A API e a RPC exigem perfil aprovado ADMIN ou RH. A consulta preserva zeros do ID e respeita o namespace configurado entre Person e AccessRecords. A migração `20261017175455_monitoring_identity_photo_review.sql` adiciona essa leitura sem alterar a migração original. Fotos de colaboradores continuam exigindo vínculo de identidade vigente; foto da própria conta também exige a configuração de vínculo da conta. As respostas usam `private, no-store`.

Os avatares voltam a tentar após “Atualizar administração”, após salvar uma configuração/vínculo e ao retornar o foco à janela quando houve falha. Não há repetição contínua de requisições. A conciliação mostra candidatos com o mesmo nome completo normalizado; mantém todos os homônimos e exige seleção, evidência e salvamento explícitos. Trocar identificador ou colaborador limpa a evidência anterior. Nome e foto não criam vínculo automaticamente.

Uma leitura autorizada do cadastro RH forneceu 384 colaboradores ativos para comparação **somente local**. O arquivo de conferência permanece na pasta ignorada `.monitoring-worker`. Entre 353 pessoas Defense, foram encontrados 326 nomes completos com um candidato RH, zero homônimos e 27 sem candidato. Esses números indicam trabalho de conferência possível, não identidades comprovadas.

Os registros AFD tipo 5 também têm dados do empregado: no perfil legado, PIS nas posições 24–35 e nome 36–87; no perfil ISO, CPF nas posições 36–47 e nome 48–99. O CPF do responsável pela alteração não foi usado. Fontes dos campos: [anexo oficial da Portaria 1510](https://www.trt2.jus.br/geral/tribunal2/ORGAOS/MTE/Portaria/anexo_Portaria_1510_MTE.pdf) e [Portaria 671 no Diário Oficial](https://pesquisa.in.gov.br/imprensa/servlet/INPDFViewer?captchafield=firstAccess&data=11%2F11%2F2021&jornal=515&pagina=237). A verificação apenas extrai os campos documentados, valida o dígito dos identificadores e preserva os registros originais; não certifica CRC, assinatura, vigência ou a identidade física do relógio.

No legado, nove registros tipo 5 contêm oito PIS distintos; quatro têm um candidato RH por nome e quatro não têm candidato. No ISO, 19 registros tipo 5 contêm sete CPF distintos; três têm um candidato e quatro não têm. Não houve nome divergente por identificador nesta amostra. Os três registros tipo 6 legados e um ISO são eventos sensíveis do equipamento, sem ponte de identidade. Nenhum vínculo foi criado por essa auditoria. Os nomes de tipo 5 permanecem evidência para revisão; não foram convertidos em vínculo de RH ou marcação de presença.

Reprodução da auditoria, sem dados pessoais no console:

```powershell
node --experimental-strip-types scripts/monitoring-identity-review-audit.ts --employees .monitoring-worker/review-employees.json --config monitoramento.example.json --person 'ACESSOS DEFENSE/Informações Pessoais-2026-10-16-16-45-12/Person202610161646078479837.xlsx' --afd-legacy 'relogio de ponto/AFD00014003750135886.txt' --afd-iso 'relogio de ponto/AFD0001400888000956517457404000969REP_C.txt'
node scripts/monitoring-photo-validation.mjs
```

A validação de fotos aplicou 21 migrations em PGlite descartável: ADMIN/RH autorizados; GESTOR, LEITURA, pendente, bloqueado, anon e service_role recusados; isolamento entre namespaces e zero inicial verificados; zero vínculos criados. Os 34 testes dirigidos de UI/API/candidatos passaram, assim como ESLint e TypeScript. Isso comprova o código local; habilitação do banco conectado e importação real são etapas distintas.
