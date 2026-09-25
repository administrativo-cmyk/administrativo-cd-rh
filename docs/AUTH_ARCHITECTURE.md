# Arquitetura de autenticação

## CPF e identificador técnico

A experiência pública usa exclusivamente CPF e senha. Como o Supabase Auth suporta password com e-mail ou telefone, mas não com um identificador arbitrário como CPF, a aplicação transforma o CPF normalizado em um identificador técnico determinístico.

O identificador é o hash SHA-256 do CPF seguido do domínio reservado `auth.administrativo-cd.invalid`. Ele nunca é exibido, não representa um e-mail pessoal e não deve receber mensagens. O CPF continua sendo a única identificação de negócio e é armazenado normalizado, com 11 dígitos, somente em `public.perfis`.

Durante o signup, `user_metadata` transporta temporariamente `nome_completo` e `cpf_normalizado` para o trigger de criação do perfil. Antes de persistir, o trigger recompõe o SHA-256 do CPF e exige correspondência exata com o identificador técnico de Auth; depois remove o CPF da metadata. Metadata nunca é usada para autorização.

O cadastro público não comprova, por si só, que o visitante é o titular real do CPF. Enquanto não existir um cadastro corporativo autoritativo e um canal de convite/ativação verificável, a aprovação exige conferência operacional da identidade pelo ADMIN/RH. O estado `PENDENTE` impede acesso imediato, mas essa conferência humana não substitui uma futura prova técnica de posse.

## Perfil, estados e papéis

Cada registro de `auth.users` gera transacionalmente um registro em `public.perfis` por meio do trigger `auth_user_criar_perfil`.

Estados:

- `PENDENTE`: cadastro criado, sem papel e sem acesso à aplicação.
- `APROVADO`: acesso liberado com papel obrigatório.
- `BLOQUEADO`: sessão pode autenticar, mas não acessa a aplicação.

Papéis:

- `ADMIN`: aprova e administra todos os papéis.
- `RH`: aprova somente `GESTOR` e `LEITURA`; não gerencia `ADMIN` ou outro `RH`.
- `GESTOR`: acessa a aplicação, sem administração de usuários.
- `LEITURA`: acessa a aplicação, sem administração de usuários.

O vínculo `gestor_id` é opcional nesta etapa. Um usuário aprovado como `GESTOR` pode permanecer sem vínculo até a importação futura do quadro real.

## RLS e operações administrativas

RLS está ativa em `public.perfis`. Um usuário autenticado consulta somente as colunas mínimas do próprio perfil. Não existe `UPDATE` genérico para `authenticated`.

A fila administrativa é fornecida por `listar_usuarios()`, que devolve CPF mascarado. As RPCs públicas são wrappers `SECURITY INVOKER`, concedidos somente a `authenticated`, e delegam para implementações `SECURITY DEFINER` no schema `private`. As implementações usam `search_path` vazio e validam explicitamente o chamador:

- `aprovar_usuario()`;
- `bloquear_usuario()`;
- `reativar_usuario()`;
- `registrar_ultimo_acesso()`.

As funções auxiliares de status e papel permanecem no schema não exposto `private`. Nenhuma policy consulta `perfis` recursivamente.

Autoaprovação, autopromoção, alteração direta do papel e edição dos campos de auditoria não são permitidas ao cliente.

## SSR, cookies e rotas

`@supabase/ssr` mantém a sessão em cookies. O `proxy.ts` do Next.js 16 atualiza tokens e aplica o primeiro redirecionamento. As páginas internas também verificam a sessão e o perfil no servidor antes de renderizar, evitando flash de conteúdo protegido.

- sem sessão: `/login`;
- `PENDENTE`: `/acesso-pendente`;
- `BLOQUEADO`: `/acesso-bloqueado`;
- `APROVADO`: aplicação;
- `/usuarios`: somente `ADMIN` e `RH`.

## Primeiro ADMIN

`scripts/promote-first-admin.mjs` é um bootstrap local e server-only. Ele exige uma chave secreta apenas no ambiente local, recusa execução quando já existe ADMIN e promove somente um perfil `PENDENTE` escolhido de forma explícita ou o único pendente existente.

O script não contém CPF, senha ou chave hardcoded e não é executado automaticamente. A chave secreta nunca pode usar prefixo `NEXT_PUBLIC_`.

## Recuperação de senha e Google

Recuperação por e-mail técnico não existe. A interface orienta o usuário a procurar RH ou administração até que um canal real de recuperação seja definido.

Google permanece apenas como ação informativa. Nenhum provider OAuth ou secret Google é configurado nesta etapa.

Falhas de cadastro usam uma única mensagem pública, inclusive quando o CPF já originou uma conta, para não revelar o estado de cadastro a visitantes.

## Limite desta etapa

Somente Auth e perfis são reais. Chamada Diária e demais repositórios operacionais continuam usando dados mock. As seis tabelas operacionais seguem sem grants e sem policies de negócio para o frontend.
