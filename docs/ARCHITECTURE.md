# Arquitetura do Administrativo CD

> Histórico: descreve a fundação inicial com mocks. O estado atual está em [MONITORAMENTO_ENTREGA.md](MONITORAMENTO_ENTREGA.md); autenticação e consultas operacionais já usam Supabase.

## Estado desta etapa

A interface aprovada continua executando com os 52 colaboradores ficticios em memoria. A fundacao Supabase e local e nao existe cliente remoto instanciado na aplicacao.

## Camadas

1. `components/` e `hooks/`: interface e estado interativo atual.
2. `lib/domain/`: entidades e regras puras, sem dependencia de React ou Supabase.
3. `lib/data/`: contratos de repositories e adaptadores mock.
4. `lib/persistence/`: formatos de persistencia, isolados dos componentes.
5. `supabase/migrations/`: schema PostgreSQL reproduzivel.

A futura implementacao Supabase deve implementar os contratos de `lib/data/repositories.ts`. Os componentes nao devem consumir linhas cruas do banco.

## Fluxo atual e futuro

```text
UI -> hook atual -> mocks

Futuro:
Server Component / Server Action -> repository -> adaptador Supabase -> PostgreSQL
```

Leituras futuras devem preferir Server Components. Mutacoes internas devem preferir Server Actions. Nenhuma chave privilegiada pode chegar a um Client Component.

## Limites de seguranca

- RLS esta habilitado em todas as tabelas publicas.
- Nao existem policies nesta etapa; `anon` e `authenticated` tambem nao possuem grants.
- Views usam `security_invoker = true`.
- `service_role` nao aparece em variaveis publicas nem no codigo cliente.
- A UI nao foi conectada ao banco.

## Supabase local

O `supabase/config.toml` usa o identificador exclusivamente local `administrativo-cd-local`, desabilita exposicao automatica de novas tabelas e nao contem project ref. A CLI esta fixada como dependencia de desenvolvimento.
