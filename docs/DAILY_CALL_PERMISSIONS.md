# Chamada Diária — matriz inicial de permissões (Etapa 5E)

| Perfil aprovado | Leitura | Escrita |
| --- | --- | --- |
| ADMIN | Todos os colaboradores operacionais | Todos |
| RH | Todos os colaboradores operacionais | Todos |
| GESTOR | Somente colaboradores cujo `colaboradores.gestor_id = perfis.gestor_id` | Somente a própria equipe |
| LEITURA | Todos os colaboradores operacionais | Nenhuma |
| PENDENTE ou BLOQUEADO | Nenhuma | Nenhuma |

O escopo do GESTOR não depende da unidade: sua equipe pode estar em CD I, CD II e CD FLV. Um GESTOR aprovado sem `gestor_id` recebe zero colaboradores e uma orientação de vínculo, nunca acesso global. Colaboradores sem gestor continuam visíveis e editáveis por ADMIN e RH, e visíveis para LEITURA; não pertencem a nenhum GESTOR.

As RPCs usam `auth.uid()` e o estado atual de `public.perfis`. A leitura aplica o filtro por `gestor_id` **dentro do banco**, antes de montar o JSON. A escrita bloqueia um UUID de outra equipe mesmo que a requisição seja construída manualmente. O helper bloqueia a linha do colaborador enquanto verifica o vínculo atual, para que uma mudança de gestor entre a consulta e a mutação não autorize a equipe anterior. `user_metadata`, estado React e parâmetros do cliente não participam da decisão.

`public.ler_chamada_diaria` e `public.salvar_chamada_diaria` são entradas `SECURITY INVOKER`; a implementação privilegiada fica em `chamada_privada`, com `search_path` fixo, `PUBLIC`/`anon` revogados e execução restrita a `authenticated`. Não há CRUD direto em colaboradores, perfis, chamadas ou auditoria. O Route Handler repete as checagens de sessão e papel, além da proteção CSRF da escrita.

Na UI, LEITURA vê status e observações sem ações de salvar ou limpar. GESTOR não recebe filtro de outros gestores, e o filtro Unidade mostra apenas unidades da equipe retornada. ADMIN e RH mantêm os filtros completos. Hoje, Período, banco de horas, métricas e drawer continuam usando a mesma leitura protegida.

Em `/usuarios`, ADMIN e RH escolhem um gestor ativo do quadro para aprovar um GESTOR. `public.vincular_gestor_usuario` altera o vínculo posteriormente sem conceder UPDATE genérico em perfis; `private.perfis_gestor_auditoria` registra ator, vínculo anterior/novo e instante. Aprovação GESTOR sem vínculo e reativação de GESTOR bloqueado sem vínculo são rejeitadas. RH pode gerir GESTOR e LEITURA, mas continua sem poder promover ADMIN/RH nem administrar usuários ADMIN/RH.

A auditoria da Chamada mantém `alterado_por = auth.uid()` para ADMIN, RH ou GESTOR autorizado; LEITURA não pode gerar alteração. `G`, clear e `expected_updated_at` mantêm a semântica da Etapa 5D. Permissão operacional da Chamada não concede permissão administrativa de usuários.
