# Chamada em lote, anexos privados e alertas operacionais

Registro local em 17/10/2026, America/Sao_Paulo. As duas migrations abaixo foram criadas pelo CLI e validadas em PGlite. Esta etapa não aplicou SQL remoto, não publicou aplicação e não alterou dados reais.

## Fluxos entregues

- **Chamada em lote:** pessoas selecionadas explicitamente dentro do filtro atual; período de até 31 dias; máximo de 100 combinações pessoa/data. Modo padrão preenche somente vazios. Substituição exige escolher o modo de revisão. A prévia mostra antes/depois, preservações e novos G/removidos G. Confirmar exige a versão da prévia; qualquer alteração relevante recusa o lote inteiro. Erro mantém rascunho, invalida a prévia e exige nova conferência.
- **Justificativas:** anexos ligados ao UUID da pessoa e à data do lançamento, dentro do drawer. Upload exige lançamento existente, descrição e acesso de escrita. PDF sem senha, PNG ou JPEG reais; até 2 MiB por arquivo; cinco ativos, dez versões e 10 MiB totais por pessoa/data. Arquivados continuam contando nas cotas. Arquivar/restaurar exige motivo e versão atual. Não há exclusão física pela interface.
- **Notificações:** busca por título/conteúdo, período, tipo, somente não lidas e arquivadas; seleção explícita da página, leitura/arquivamento/restauração em lote. Cada item leva sua versão e o lote é atômico. Avisos e notificações de férias existentes foram preservados.
- **Alertas de Chamada:** decisões registradas como bloqueadas ou pendentes, de dias anteriores, dentro da equipe atual; revisão manual remove a pendência. Não cria faltas, não atribui G e não presume ausência a partir de falta de dados.
- **Alertas de importação:** somente ADMIN/RH e fontes ativas; erro informado pelo coletor, nenhuma conclusão registrada ou última conclusão há mais de 24 horas. O texto orienta conferir a rotina e informa que isso não prova falha do relógio, cobertura da coleta ou ausência do colaborador.

O Banco de Horas continua derivado dos registros G pela regra existente. O lote usa a mesma operação de revisão individual, na mesma transação; não executa um segundo débito de saldo.

## Contratos e segurança

| Canal | Operações |
| --- | --- |
| `POST /api/daily-call/batch` | `preview` / `apply`; `mode`, `reason`, `items`, `expectedVersion` na confirmação |
| `GET /api/daily-call/attachments?employeeId&date` | Metadados autorizados, incluindo arquivados |
| `GET /api/daily-call/attachments?id` | Download autorizado de anexo ativo |
| `POST /api/daily-call/attachments` | Upload limitado ou `archive` / `restore` com CAS |
| `POST /api/workspace` | Filtros de `notifications` / `notices`; `notification_state_batch` com operação, chaves e versões |

Autorização: perfil aprovado; escrita de Chamada e consulta/download/escrita dos anexos para ADMIN/RH/GESTOR; gestor restrito à equipe atual. LEITURA mantém consulta de Chamada e indicadores, sem acesso aos documentos anexados. Sessão e origem são verificadas na API; papel e equipe são revalidados no banco. Transferência de equipe e mudança de papel não concedem acesso com uma prévia antiga.

Os bytes ficam em `private.daily_call_attachments`, sem bucket, URL pública ou acesso direto concedido aos papéis de aplicação. A RPC autenticada não permite upload. Apenas `service_role` executa `daily_call_attachment_upload`, depois da validação no servidor, usando o ator verificado na sessão. O cliente não pode informar esse ator. A configuração reutiliza `MONITORING_SUPABASE_SERVICE_ROLE_KEY`; nenhuma credencial nova é exigida.

Validação real: `pdf-lib@1.17.1` abre o documento, exige 1–100 páginas e recusa criptografia, scripts, ações automáticas e arquivos embutidos; `sharp@0.35.4` decodifica integralmente PNG/JPEG, limita a dez milhões de pixels e recusa imagens truncadas ou incompatíveis. O SQL ainda verifica tamanho, assinatura e cotas. Não há antivírus nesta entrega.

Downloads exigem autorização a cada requisição e retornam `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` e CSP restritiva. Não há segredo, conteúdo ou base64 nos logs. Erros operacionais retornam mensagem pública e identificador de correlação.

Auditoria de anexos: `private.daily_call_attachment_audit(id, attachment_id, employee_id, operational_date, action, actor, reason, metadata, created_at)`. Metadados guardam nome, tipo, tamanho, hash e estado de arquivo; não contêm os bytes. A auditoria central pode consultar esse registro.

## Migrations e dependências

1. `20261018021828_daily_call_batch_attachments_notifications.sql`: lote e anexos privados.
2. `20261018022114_workspace_operational_notifications.sql`: filtros/ações de notificações e alertas. Depende de `active`/`label` adicionados em `20261018021924_monitoring_binding_sources_operational_imports.sql`.

As migrations anteriores já aplicadas não foram alteradas. `20261018022209_central_audit_history.sql`, da frente central, depende dos metadados de auditoria de anexos acima.

## Evidência local

Comando dirigido executado: `pnpm exec vitest run lib/daily-call-operations.integration.test.ts lib/daily-call-attachment-validation.test.ts app/api/daily-call/operations-route.test.ts lib/workspace/workspace-integration.test.ts lib/workspace/workspace-review.test.ts components/daily-call-operations.test.tsx components/workspace/workspace-apps.test.tsx components/daily-call-permissions.test.tsx components/daily-call-real-ui.test.tsx`.

**48 testes passaram em nove arquivos.** Incluem:

- prévia sem escrita, CAS e reversão atômica, preservação de lançamentos existentes e escopo de gestor;
- repetição G com uma nova prévia mantendo um único consumo;
- negação de upload direto autenticado e de acesso ao helper interno; grants exclusivos do serviço;
- serviço revalidando papel/equipe do ator, download privado, CAS de arquivo/restauração e duplicidade;
- cinco ativos, dez versões e 10 MiB mesmo com versões arquivadas;
- parser real, formatos falsos, PDF com scripts/anexos, excesso, payload limitado e ausência de chamada privilegiada após rejeição;
- alertas com escopo/papel/fonte ativa, filtros reais e estado em lote com CAS;
- interface exigindo prévia, invalidando-a após alteração, conservando arquivo/justificativa/motivo após erro e sem ações de escrita para leitura.

Lint dos arquivos desta frente passou. O typecheck global neste instante apontou somente `test/monitoring-source-sync.test.ts:14`, em edição na frente de ingestão, já comunicado ao responsável. O ciclo global final pertence à coordenação.

## Limites explícitos

- Alertas da Chamada usam decisões persistidas pelo processamento; não inventam uma decisão para pessoa/data ainda não processada.
- “Sem importação recente” usa janela informativa fixa de 24 horas, não um SLA configurado de coleta. Rotinas menos frequentes precisam ser interpretadas pelo administrador.
- Arquivamento preserva a evidência e sua cota; descarte/retenção definitiva não foi implementado.
- Esta evidência é local/sintética. Aplicação das migrations, publicação e QA autenticado dos novos fluxos reais são etapas distintas.
