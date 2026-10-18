# Fluxo visual de autenticação

> Histórico da etapa frontend. Para a autenticação real, consulte [AUTH_ARCHITECTURE.md](AUTH_ARCHITECTURE.md); para o estado atual da entrega, [MONITORAMENTO_ENTREGA.md](MONITORAMENTO_ENTREGA.md).

## Estado atual

A Etapa 2.6 implementa somente a experiência frontend das rotas `/login`, `/cadastro` e `/cadastro/sucesso`. A interface usa `AuthService` como contrato e `MockAuthService` como implementação demonstrativa local.

Não existe nesta etapa criação de usuário, sessão persistente, recuperação de senha, OAuth, envio de e-mail ou consulta ao banco. O botão Google e o acesso por CPF exibem apenas feedback demonstrativo.

## Fluxo futuro de aprovação

```text
Novo cadastro
      ↓
   PENDENTE
      ↓
Aprovação ADMIN/RH
      ↓
   APROVADO
      ↓
Acesso ao sistema
```

Um cadastro com status `BLOQUEADO` não terá acesso. O usuário nunca escolhe o próprio perfil; essa atribuição será responsabilidade da administração.

## Preparação para a próxima etapa

Uma futura implementação real deverá cumprir o contrato `AuthService` (`signIn`, `signUp`, `signOut` e `resetPassword`) e substituir a injeção do mock nos formulários. A integração deve preservar a UI e tratar credenciais, sessão, aprovação e erros no serviço real.

Nenhum serviço Supabase foi implementado ou alterado nesta etapa.
