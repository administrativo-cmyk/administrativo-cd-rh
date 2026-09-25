# Supabase remoto — Administrativo CD

## Destino autorizado

- Organização: `Administrativo CD`
- Projeto: `administrativo-cd-rh`
- Região: South America (São Paulo), `sa-east-1`
- Criado em: 2026-09-24
- Situação: fundação de autenticação e perfis aplicada, sem usuários ou dados reais de RH

O projeto `supabase-almond-village` contém dados de outro aplicativo e está fora do escopo do App RH. Ele não deve ser vinculado, migrado ou alterado por este workspace.

## Migrations aplicadas

1. `20260923204012_domain_foundation.sql`
2. `20260923204014_bank_hours.sql`
3. `20260923204015_daily_attendance.sql`
4. `20260923204017_views_indexes_rls.sql`
5. `20260924143652_seed_reference_units.sql`
6. `20260924195656_authentication_profiles_approval.sql`
7. `20260925112752_harden_auth_rpc_exposure.sql`
8. `20260925120000_enforce_auth_identifier_binding.sql`

## Estrutura criada

Tabelas:

- `unidades`
- `gestores`
- `lotes_importacao`
- `colaboradores`
- `banco_horas_medicoes`
- `chamada_diaria`
- `perfis`

Views com `security_invoker = true`:

- `vw_colaboradores_mensurados`
- `vw_banco_horas_ciclos`
- `vw_banco_horas_atual`
- `vw_banco_horas_resumo`
- `vw_chamada_diaria_contexto`

Unidades estruturais:

- `CD I`
- `CD II`
- `CD FLV`

## Segurança e exposição

- RLS está habilitado nas sete tabelas.
- As seis tabelas operacionais continuam sem policies de aplicação e sem grants para `anon` ou `authenticated`.
- `perfis` permite ao usuário autenticado apenas a leitura das colunas mínimas do próprio perfil; não existe `UPDATE` genérico.
- A administração de perfis usa wrappers públicos `SECURITY INVOKER` e implementações privilegiadas no schema `private`, com validação de papel no banco.
- O projeto mantém os privilégios padrão da plataforma para futuros objetos do schema `public`; essa configuração global da Data API não foi alterada.
- As implementações privilegiadas estão no schema `private` com `SECURITY DEFINER`, `search_path` vazio e execução revogada de `public`, `anon` e `authenticated`; apenas wrappers públicos `SECURITY INVOKER` com grants mínimos são expostos.
- O trigger de criação valida que o e-mail técnico corresponde ao SHA-256 do CPF normalizado antes de persistir o perfil e remove o CPF do metadata de Auth após o uso.
- Auth e `perfis` permanecem com zero registros após a remoção dos usuários fictícios de teste.
- Storage permanece com zero buckets.
- Nenhuma Edge Function foi criada ou implantada.

## Dados

Nenhum gestor, colaborador, lote, saldo de banco de horas ou chamada diária real foi importado. Somente as três unidades estruturais foram persistidas. Os testes SQL remotos usaram dados fictícios dentro de transação com `ROLLBACK`, e a ausência desses registros foi confirmada depois.

## Aplicação

O frontend continua usando `MockDailyCallRepository` para Chamada Diária e demais dados operacionais. A autenticação usa o projeto remoto oficial por meio de URL e chave publicável no ambiente local ignorado pelo Git; nenhuma chave secreta é exposta ao navegador ou versionada.
