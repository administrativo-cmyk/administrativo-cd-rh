# Supabase remoto — Administrativo CD

## Destino autorizado

- Organização: `Administrativo CD`
- Projeto: `administrativo-cd-rh`
- Região: South America (São Paulo), `sa-east-1`
- Criado em: 2026-09-24
- Situação: fundação criada, sem Auth de aplicação e sem dados reais de RH

O projeto `supabase-almond-village` contém dados de outro aplicativo e está fora do escopo do App RH. Ele não deve ser vinculado, migrado ou alterado por este workspace.

## Migrations aplicadas

1. `20260923204012_domain_foundation.sql`
2. `20260923204014_bank_hours.sql`
3. `20260923204015_daily_attendance.sql`
4. `20260923204017_views_indexes_rls.sql`
5. `20260924143652_seed_reference_units.sql`

## Estrutura criada

Tabelas:

- `unidades`
- `gestores`
- `lotes_importacao`
- `colaboradores`
- `banco_horas_medicoes`
- `chamada_diaria`

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

- RLS está habilitado nas seis tabelas.
- Não existem policies de aplicação nesta etapa.
- As tabelas e views do App RH não possuem grants para `anon` ou `authenticated`.
- O projeto mantém os privilégios padrão da plataforma para futuros objetos do schema `public`; essa configuração global da Data API não foi alterada.
- As funções auxiliares estão no schema `private`, sem `SECURITY DEFINER`.
- Auth permanece com zero usuários.
- Storage permanece com zero buckets.
- Nenhuma Edge Function foi criada ou implantada.

## Dados

Nenhum gestor, colaborador, lote, saldo de banco de horas ou chamada diária real foi importado. Somente as três unidades estruturais foram persistidas. Os testes SQL remotos usaram dados fictícios dentro de transação com `ROLLBACK`, e a ausência desses registros foi confirmada depois.

## Aplicação

O frontend continua usando `MockDailyCallRepository`. URL, chave pública e credenciais do projeto remoto ainda não foram adicionadas à aplicação.
