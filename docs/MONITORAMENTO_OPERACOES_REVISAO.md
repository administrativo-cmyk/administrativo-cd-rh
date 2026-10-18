# Revisão de identidades, fontes e lotes operacionais

Implementação local da migration `20261018021924_monitoring_binding_sources_operational_imports.sql`. Este documento não comprova aplicação no banco conectado. O arquivo real de cadastro do relógio ainda precisa ser fornecido e conferido.

## Identidades

Conciliação permite editar, remover e restaurar vínculos CPF/PIS/Defense. Cada alteração exige versão exibida, motivo e perfil aprovado ADMIN/RH. Edição/restauração criam outra revisão e preservam a anterior. Revisão substituída não pode ser restaurada diretamente. CPF/PIS exigem onze dígitos e verificadores válidos; o tipo deve corresponder à fonte. Sobreposição de vigência na mesma identidade/namespace é recusada.

O histórico mostra colaborador, identificador, fonte, evidência, revisão e vigência. Datas retroativas podem afetar apurações; a fila inclui eventos já importados da nova identidade. Revisões manuais da Chamada permanecem protegidas pelas regras existentes. Nome e foto nunca vinculam automaticamente.

Rota `POST /api/monitoring/bindings`, ações `create`, `replace`, `revoke`, `restore`; RPC `monitoring_binding_change`. Auditoria em `monitoring_audit`, ações com sufixo `_binding`.

## Cadastro do relógio e Banco de Horas

A Conciliação oferece “Importar cadastro do relógio”. A gestão de medições oferece “Importar lote de medições”. Ambos aceitam CSV/XLSX até 4,3 MB (4.300.000 bytes) e 2.000 registros. O envio multipart completo é limitado a 4.400.000 bytes, abaixo do teto HTTP da Vercel. O usuário escolhe aba, cabeçalho, separador/codificação CSV e mapeamento. A amostra não grava vínculos ou medições. Fórmulas nos campos mapeados são recusadas. A expansão real do ZIP é limitada antes de carregar XLSX; diretórios inseguros, macros e arquivos inconsistentes são recusados.

- Relógio: matrícula, nome completo e pelo menos CPF ou PIS do trabalhador. Fonte AFD, vigência e evidência escolhidas explicitamente. Matrícula deve corresponder exatamente ao RH ativo, incluindo zeros; o nome deve corroborar essa matrícula. Divergência, identificador inválido ou repetido bloqueiam a linha. Nome sozinho nunca encontra ou aprova um colaborador.
- Banco de Horas: matrícula, data da medição, início de vigência, jornada diária e saldo. Nome é opcional; se fornecido, precisa conferir. Formato do saldo escolhido: minutos inteiros, horas/minutos ou horas decimais. Datas textuais usam formato ISO ou brasileiro escolhido; datas nativas de Excel mantêm a data do arquivo.
- Prévia por registro, sem seleção automática. Confirmação aplica apenas linhas selecionadas, até 200 por requisição. No CSV, a numeração representa registros lógicos; texto entre aspas com quebras de linha continua no mesmo registro.
- Cada linha usa uma subtransação; falhas não desfazem sucessos de outras linhas. Repetir a confirmação não duplica sucessos. Reenviar o mesmo arquivo/mapeamento revalida pendências após correções no RH e renova a validade de sete dias, preservando sucessos.
- Medições usam a RPC individual e sua auditoria. Vigência já ocupada gera erro por linha e exige revisão individual; o lote não sobrescreve o saldo existente. Cadastro do relógio reconhece vínculo já idêntico e não o duplica.

Rotas `POST /api/monitoring/clock-register` e `POST /api/time-bank-admin/import`. Multipart `inspect`/`preview`; JSON `confirm` com ID, versão e linhas. `get` recupera o lote da própria conta. RPC `operational_import`, staging `private.operational_import_batches`/`private.operational_import_rows`, RLS e sem grants diretos. ADMIN/RH não leem lotes de outra conta. Nenhum arquivo original é salvo ou alterado pelo upload. Auditoria do lote em `monitoring_audit`; medições em `private.time_bank_measurement_audit`.

## Fontes e coleta neste computador

A tela Importação permite criar, editar e desativar fontes com motivo e CAS. Campos: ID estável, nome, tipo, fuso, namespace, estado ativo, conferência do equipamento e cobertura contínua declarada. Tipo/fuso/namespace ficam imutáveis após uso. Cobertura exige datas com fuso. Mudanças de cobertura/conferência enfileiram apuração afetada; alterações de nome preservam o histórico.

A versão é `configuration_updated_at`; heartbeats não a alteram. Fontes gerenciadas pela tela não aceitam que um worker antigo sobrescreva cobertura/conferência. `active=false` impede ingestão no SQL e leitura pelo worker. Histórico anterior permanece disponível. Notificações ignoram fontes desativadas.

Rotas `GET/POST /api/monitoring/sources`; RPC `monitoring_sources_admin`. `POST /api/monitoring/ingest/sources` exige token e allowlist `MONITORING_INGEST_SOURCE_IDS`; consulta apenas IDs solicitados. Retorna metadados e estado, nunca caminhos. RPC `monitoring_worker_sources` exclusiva de `service_role`.

Config local mantém `version: 1`. `source.enabled` é opcional, assume `true`; `false` local nunca é ligado pelo servidor. Antes de aplicar varredura, o worker consulta metadados: falha da consulta, fonte desconhecida ou divergência do contrato impedem leitura. `root`, `photoRoot`, perfil AFD, codificação e recursividade continuam exclusivamente locais.

Uma fonte criada na tela precisa ter pasta autorizada no computador da coleta. Exemplo, a substituir e conferir em prévia antes de acrescentar `--apply`:

```powershell
node --experimental-strip-types scripts/monitoring-register-source.mjs --id ID_DA_FONTE --root "PASTA_AUTORIZADA" --kind afd --namespace ESPACO_DA_IDENTIDADE --afd-profile iso
```

Escolha perfil `legacy`/`iso` conforme o AFD. Para Defense, use `defense-access`/`defense-person`, sem perfil AFD; fotos usam `--photo-root`. Registro local não atualiza variáveis de hospedagem remota: ela precisa autorizar o mesmo ID na allowlist. O navegador não executa comandos nem escolhe caminhos de disco.

## Validação isolada

`supabase/tests/monitoring-operations.sql` verifica permissões, RLS/grants, CAS, revisões, conflitos, checksum, vigência, correspondência exata, idempotência, falha parcial financeira, auditoria individual, fila da identidade nova e preservação da Chamada. Executado por `lib/monitoring/operations-integration.test.ts` em PGlite descartável com todas as migrations locais; rollback, sem `.env` ou banco remoto.

Testes adicionais: `lib/monitoring/import-file.test.ts`, `lib/monitoring/operations-api.test.ts`, `test/monitoring-source-sync.test.ts`, `components/monitoring/operational-flows.test.tsx`. Exercitam limites/expansão de ZIP, mapeamento, datas/saldos, nomes divergentes, origem/sessão, allowlist/token, seleção explícita, CAS na tela e rejeição de caminhos remotos.

Rodada dirigida final: **132 testes em 17 arquivos passaram**. Runner de migrations isolado: **32 migrations**, zero FK sem índice. Esses resultados comprovam código local; não equivalem a ativação remota ou importação do futuro arquivo real.
