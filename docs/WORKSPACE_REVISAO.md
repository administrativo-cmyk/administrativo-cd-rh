# Revisão independente — preferências e notificações

Data: 17/10/2026. Escopo: `lib/workspace/**`, `app/api/workspace`, migration `20261018002155_workspace_preferences_notifications.sql` e efeitos no cabeçalho/entrada do sistema. Nenhuma operação remota.

## Achado corrigido

O reset removia a linha de preferências e voltava a versão para `null`. Um cliente antigo que havia consultado a ausência inicial da linha podia salvar depois de outra sessão salvar e restaurar os padrões, sem conflito de versão. A implementação foi corrigida pelo responsável da migration: reset mantém a linha e grava os padrões com versão monotônica. O novo teste prova que `expectedUpdatedAt: null` antigo é recusado após esse ciclo.

## Verificações

- Sujeito vem de `auth.uid()` e perfil aprovado atual. ID e papel enviados indevidamente no payload de perfil não mudam o alvo nem elevam permissões.
- RLS e ACL fecham acesso direto às tabelas privadas; o helper de notificações não aceita execução pelo papel autenticado. A API valida origem, sessão, tamanho, ação e formato; falhas não devolvem mensagens internas do banco.
- Preferências, leitura e arquivamento de notificações pertencem ao usuário autenticado. Aviso destinado a gestor não aparece para outra equipe. RH não consulta/edita avisos restritos a ADMIN; GESTOR/LEITURA não administram avisos.
- Solicitação de férias aparece para ADMIN/RH. Aprovação/cancelamento aparece somente para o criador; GESTOR ainda precisa ter o colaborador na equipe atual. Outro gestor da mesma equipe não recebe a decisão.
- Transferência de equipe revoga tanto a leitura quanto a atualização do estado da notificação anterior. Arquivamento esconde o planejamento; restauração e revisões geram nova chave, sem herdar a leitura de versão antiga.
- Avisos respeitam CAS ao editar, arquivar e restaurar. Usuários pendentes/bloqueados são recusados, inclusive por RPC direto.
- Efeitos reais: entrada `/` consulta o dashboard escolhido; densidade altera padding das tabelas via `data-density`; preferências de notificação alteram a contagem do cabeçalho. A caixa continua acessível.
- Revisão dos campos de unidade/colaborador não encontrou falha material adicional; validação e CAS permanecem no servidor. Testes anteriores verificam rascunho de unidade após conflito.

## Evidência

Arquivo novo: `lib/workspace/workspace-review.test.ts`, com cinco cenários SQL isolados, usando fixtures sintéticas e todas as migrations locais.

Comando executado:

```text
npx vitest run lib/workspace/workspace-review.test.ts lib/workspace/workspace-integration.test.ts app/api/workspace/route.test.ts components/workspace/workspace-apps.test.tsx
```

Resultado: **21 testes passaram**. ESLint do teste e Typecheck global também passaram. Nenhuma falha material remanescente identificada neste escopo. Esta evidência é local; não certifica aplicação da migration nem operação administrativa bem-sucedida no banco remoto.
