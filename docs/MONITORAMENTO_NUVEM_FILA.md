# Fila de importação pela nuvem

**Estado atual: publicado, ativado e validado de ponta a ponta com AFD legado real.** O commit `ad9b8fe` está publicado na Vercel, deployment `8nW5dZ6FMMpc4ZiR7QmLzwh52HpB`, estado **Ready**. A migration `20261019012323_monitoring_cloud_upload_jobs.sql` foi aplicada no projeto autorizado `kqgtnucqxqqgwdyvhvdd`: **33 migrations no total**, bucket privado com limite de **20 MiB** e **uma única tarefa Cron ativa a cada minuto**.

A consulta autenticada ADMIN mostrou **quatro fontes e `automationReady: true`**. Smoke público: saúde/login HTTP 200 e `/api/monitoring/cloud/run` HTTP 401 sem credencial. **849 testes e build passaram** antes da publicação. **AFD ISO e Defense têm cobertura por testes locais; a validação real de produção desta etapa usou somente AFD legado.**

## Evidência real de produção

Em **18/10/2026, horário de Brasília**, a interface confirmou recebimento às **23:16:26**. A navegação saiu da Importação para Dashboards antes do disparo. O Cron iniciou às **23:17:00**; o runner concluiu às **23:17:03.274**, com HTTP **200**, sem timeout. A auditoria registrou **um job, concluído em uma tentativa**, **668 linhas processadas de 668**, **dois lotes de dois**, erro nulo, lease encerrado e **um original no Storage**.

Foi reenviado um AFD legado já importado para validar idempotência; nenhum dado novo foi introduzido neste ensaio.

As sete contagens canônicas preservaram a base anterior, todas com **delta zero**: eventos **45.266**, ocorrências **45.717**, arquivos **4**, pessoas de origem **353**, fotos **299**, vínculos **325** e colaboradores **384**. Evidência: `artifacts/cloud-validation/live-after.json`, local e ignorada pelo Git. Não houve necessidade de manter a tela de Importação aberta. O computador não foi desligado no ensaio e o runtime local permaneceu intacto.

## Arquivos e limites

- Migration nova, gerada pelo CLI: `20261019012323_monitoring_cloud_upload_jobs.sql`.
- Ativação separada aplicada: `supabase/cloud-monitoring-cron.sql`; a tarefa única ativa foi conferida após publicação do endpoint.
- Bucket privado: `monitoramento-originais`, limite de 20 MiB por objeto. Upload usa token assinado emitido pelo servidor para caminho opaco específico; não passa os bytes pela função Vercel.
- Até 10 envios ativos por usuário e 100 globalmente. Reserva e originais armazenados têm teto de 500 MiB. O cálculo considera o maior valor entre tamanho declarado e tamanho registrado pelo Storage.
- Envios cancelados ou falhos sem objeto mantêm a reserva por três horas, cobrindo a validade de duas horas dos tokens de upload e uma margem. Após esse período, reservas vazias deixam de ocupar capacidade. Objetos realmente existentes continuam contabilizados, independentemente do estado do job.
- Não há exclusão automática de originais. Quando arquivos reais atingirem a quota, será necessária manutenção explícita de retenção. Cancelar interrompe o processamento futuro; não exclui eventos já persistidos nem o original.

## Contrato SQL

`monitoring_cloud_admin(p_action text, p_data jsonb)` exige perfil atual aprovado ADMIN ou RH. Papéis LEITURA, GESTOR e anônimo não têm acesso administrativo.

| Ação | Dados | Retorno |
|---|---|---|
| `list` | `offset?`, `limit?` (1–100) | `jobs`, `total`, `offset`, `limit`, `maxFileBytes`, `automationReady`, `sources:[{id,name,kind}]` |
| `create` | `sourceId`, `fileName`, `byteLength`, `sha256`, `parserVersion`, `afdProfile?`, `encoding?` | `job`, `duplicate`, `uploadPresent` |
| `get` | `id` | `job` |
| `complete` | `id`, `expectedUpdatedAt` | `job` |
| `retry`, `cancel` | `id`, `expectedUpdatedAt` | `job` |

AFD exige perfil explícito `legacy` ou `iso` e extensão `.txt`; Defense exige `.xlsx`. Nome até 200 caracteres, sem caminhos ou controles. A fonte deve estar ativa. Identidade, fuso, namespace, cobertura declarada, confirmação da origem, perfil AFD e codificação ficam congelados. Mudanças semânticas impedem continuação com configuração antiga.

`complete` consulta `storage.objects` e exige tamanho exato. Repetir confirmação já aplicada é idempotente. Essa consulta comprova o objeto/tamanho; a verificação dos bytes e SHA-256 é responsabilidade obrigatória do runner antes de persistir qualquer lote.

Identidade viva única: fonte + SHA-256 + parser nos estados uploading/queued/processing/completed. Envios falhos ou cancelados permitem nova submissão explícita, com ID e caminho novos. A idempotência canônica da ingestão continua evitando eventos duplicados. Uma tentativa antiga não pode ser reativada se outra submissão viva da mesma identidade já existe.

`monitoring_cloud_worker(p_action text, p_data jsonb)` é exclusivo de `service_role`:

| Ação | Dados | Efeito |
|---|---|---|
| `claim` | `tokenHash` | Consome autorização temporária e obtém no máximo um job; retorna `{job,reprocess}` |
| `persist` | `id`, `leaseToken`, `expectedCursor`, `batch`, `plan` | Executa ingestão e avanço do checkpoint na mesma transação |
| `extend` | `id`, `leaseToken` | Renova lease |
| `release` | `id`, `leaseToken` | Devolve continuação à fila sem gastar nova tentativa |
| `fail` | `id`, `leaseToken`, `code`, `retryable` | Registra código sanitizado e aplica espera progressiva ou falha terminal |
| `finish` | `id`, `leaseToken` | Conclui apenas com todos os lotes/linhas e arquivo canônico concluído |

O job usa os campos camelCase combinados com a API: `id`, `sourceId`, `source`, `fileName`, `bucket`, `objectPath`, `byteLength`, `sha256`, `parserVersion`, `status`, `cursor`, `processedRows`, `totalRows`, `totalBatches`, `plan`, `attempts`, `maxAttempts`, `nextRetryAt`, `lastError`, `createdAt`, `updatedAt`, `completedAt`. Somente respostas internas de processamento incluem `leaseToken`, `leaseVersion` e `leaseExpiresAt` quando houver lease vigente.

O plano fixo contém `version:1`, `parserVersion`, `batchSize:500`, `bodyLimitBytes:4400000`, `totalBatches`, `occurrenceCount` e `layoutHash`. O primeiro lote grava plano e checkpoint juntos; seguintes exigem igualdade integral. Replay do último lote exige o mesmo hash do lote e plano. Falha SQL não deixa arquivo/eventos parciais daquela transação nem avança cursor.

Lease de 300 segundos, token UUID novo e versão crescente a cada aquisição. Expiração, cancelamento e retomada impedem gravações por um runner antigo. Limite de cinco tentativas por job; pausas normais entre fatias não consomem tentativa. Falhas recuperáveis aguardam 60, 120, 240 e 480 segundos antes das próximas tentativas. Novo envio explícito após falha cria outro job, preservando o histórico.

## Agendamento e autorização

O script instala uma tarefa nomeada a cada minuto. O banco só chama a URL fixa `https://administrativo-cd-rh.vercel.app/api/monitoring/cloud/run` quando há importação ou recálculo elegível. Uma importação com lease vigente impede novo disparo de importação. O agendamento permanece separado da migration portátil.

`automationReady` permanece falso sem a função de dispatch e a tarefa ativa com nome, frequência e comando esperados. API e tela usam esse sinal para impedir novos uploads antes da ativação. Esse indicador confirma configuração; não substitui a verificação da última execução HTTP.

O banco emite uma capacidade aleatória de 256 bits, guarda apenas SHA-256 e exige consumo único em até 60 segundos. A requisição `pg_net` leva somente essa capacidade no Bearer; não transporta `service_role`, senha, token permanente do importador ou segredo novo. A API usa sua credencial de serviço existente para consumir o hash e reclamar o trabalho atomicamente. Cabeçalhos do `pg_net` podem ser lidos por papéis do banco; por isso a capacidade é curta, descartável e só autoriza obter trabalho já existente na fila.

O schema `net` deve permanecer fora dos schemas expostos pela Data API. No Supabase gerenciado, seus objetos e grants pertencem a `supabase_admin`; executar `REVOKE` como `postgres` não remove esses grants. A documentação também alerta que remover os grants PUBLIC das tabelas interrompe o acesso usado pelo próprio pg_net. Portanto, o script não apresenta revogações ineficazes como garantia de isolamento. A segurança não depende do sigilo do cabeçalho na fila HTTP. [Restrição oficial de permissões](https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16).

`pg_net` aguarda até 240 segundos; runner tem orçamento menor que o limite Vercel. Na validação operacional, distinguir sucesso SQL do Cron de resposta HTTP concluída: a configuração ativa, isoladamente, não prova processamento bem-sucedido. A fila de negócio é persistente; não depende da durabilidade da fila HTTP de `pg_net`.

Recálculos usam a fila existente. Vínculos revogados e fontes desativadas também podem precisar invalidar resultados antigos; o gatilho considera esses casos. A API deve usar a allowlist de fontes também para recálculo, incluindo fontes desativadas nessa operação de invalidação. Desativação continua impedindo nova importação.

## Evidência local

- Migration compilada junto às 32 anteriores em PGlite; validador global passou com 33 migrations e zero grants expostos ou índices de FK faltantes.
- 23 testes dedicados passaram. Exercitam papéis, Storage privado com uma política permissiva antiga simulada, confirmação por metadados, duplicação/reenvio, tokens expirados/usados, leases, cancelamento, CAS, planos, replay, ingestão transacional, cotas, espera e limite de tentativas, recálculo após revogação/desativação e prontidão do agendamento.
- O script Cron é exercitado com substitutos SQL de `cron` e `net`: uma única tarefa nomeada, nenhuma chamada sem trabalho, endpoint fixo e capacidade descartável. Esse teste não faz rede nem prova a extensão remota.
- Typecheck global e lint do teste passaram. Testes não usam dados reais nem enviam arquivos ao Storage remoto.
