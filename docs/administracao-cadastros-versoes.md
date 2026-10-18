# Cadastros, planejamento e revisões administrativas

Implementação local de 17/10/2026. As migrations desta etapa ainda dependem de ativação autorizada; testes locais não comprovam aplicação em produção.

## Cadastros e férias

`POST /api/administration` recebe `{entity, action, data}`. Entidades: `unit`, `manager`, `employee`, `vacation`. Ações: `list`, `save`, `archive`, `restore`.

ADMIN/RH gerenciam unidades, gestores e colaboradores. Matrícula permanece texto, com zeros preservados. Exclusão é reversível: desativar ou arquivar mantém os IDs e todo o histórico. Unidades ou gestores ainda referenciados por cadastros ativos não podem ser arquivados. Restauração exige referências ativas.

Planejamento registra colaborador, período aquisitivo opcional, início/fim, observação e status `draft`, `requested`, `approved`, `cancelled`. GESTOR consulta sua equipe e altera propostas próprias enquanto permitidas. ADMIN/RH aprova. Sobreposição de férias aprovadas é recusada. Aprovação não grava Chamada, batidas, banco de horas ou situação cadastral automaticamente.

Atualização, arquivamento e restauração exigem `id`, `expectedUpdatedAt` e justificativa. Auditoria privada guarda autor e estados anterior/posterior. `updatedAt` avança mesmo em operações dentro da mesma transação. O snapshot lista `datasetVersion`, um SHA256 de todas as linhas filtradas, opções e escopo; paginação não muda a versão. Exportações devem comparar todas as páginas.

Mudanças de colaborador invalidam suas apurações e enfileiram resultados existentes, inclusive quando eventos ou vínculos já não estão ativos. Alterar nomes de unidade/gestor atualiza a versão de consulta sem inutilizar cálculos. Locks de jobs antecedem locks da revisão e do colaborador.

## Gestão de usuários

`POST /api/administration/users`, ações `list` e `save`, usa somente a sessão autenticada. Edição recebe `{id, expectedUpdatedAt, name, role, managerId, reason}`. Nome, papel e vínculo são gravados juntos; status de acesso continua nas operações de aprovação, bloqueio e reativação.

ADMIN pode administrar papéis. RH administra apenas GESTOR/LEITURA e não atribui ADMIN/RH. Um gestor ativo é obrigatório para GESTOR; outros papéis removem explicitamente esse vínculo. Edição de pendentes é recusada até aprovação. A proteção do último ADMIN aprovado vale também para mudanças de papel.

`private.user_edit_audit` registra mudanças sem copiar CPF. O histórico anterior de vínculos aceita destino nulo para registrar a remoção ao sair do papel GESTOR. O trigger monotônico do perfil pertence à migration de preferências do workspace, evitando duplicidade.

## Configurações de Monitoramento

O endpoint existente `/api/monitoring/config` acrescenta `replace_setting` e `restore_setting`. Essas ações, e `revoke_setting`, exigem `id`, `expectedUpdatedAt`, `reason`. Substituição também recebe `setting` no contrato habitual. A RPC é `monitoring_setting_change`.

Edição mantém tipo e destino, revoga a revisão atual e cria a sucessora na mesma transação. A sucessora incrementa `revision` e referencia `supersedes_id`; o conteúdo antigo permanece. Restauração cria outra revisão, não reativa silenciosamente uma linha histórica. Uma revisão já substituída não pode ser restaurada diretamente. Sobreposição, dados inválidos ou versão antiga desfazem toda a operação.

A interface mostra revisão, vigência, histórico e ações disponíveis. Todos os campos são preenchidos na edição, incluindo múltiplas janelas de café. Motivo é obrigatório em cada alteração. A validação SQL protege também chamadas diretas da RPC de criação, edição e restauração. A remoção antiga sem versão foi encerrada; clientes precisam usar o contrato atual.

## Evidência local

- Migrations `20261018001547_administrative_registers_planning`, `20261018002155_workspace_preferences_notifications` e `20261018003008_administrative_users_settings_versions` aplicadas em PGlite descartável para os testes desta frente.
- Cenários SQL: autorização, equipe, versão antiga, referências, zeros de matrícula, arquivamento/restauração, férias sobrepostas, último ADMIN, desvínculo de gestor, substituição atômica, recuperação e jobs.
- APIs: origem, sessão, papel, validação, CAS obrigatório, mensagem sanitizada e cache privado.
- Interface: edição de usuário, justificativa, papéis permitidos, preenchimento da regra, preservação de janelas e restauração com versão.
- Testes usam identidades sintéticas e rollback. Não criam cadastros, vínculos ou lançamentos remotos. Concorrência foi verificada por contratos de CAS e revisão da ordem de locks; PGlite não comprova concorrência entre conexões PostgreSQL reais.

Arquivos de referência: `lib/administration/contracts.ts`, `lib/administration/users-contracts.ts`, `supabase/tests/administrative.sql`, `supabase/tests/administrative-users-settings.sql`.
