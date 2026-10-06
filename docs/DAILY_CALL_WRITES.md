# Chamada Diária — escrita controlada (Etapa 5D)

## Contrato e autorização

O endpoint server-side `PUT /api/daily-call/entry` exige sessão Supabase e perfil `APROVADO/ADMIN`, valida o corpo e usa o cliente SSR com a identidade do usuário. O banco repete a checagem em `public.salvar_chamada_diaria`; `auth.uid()` é a única origem de `created_by`, `updated_by` e `alterado_por`. `user_metadata`, `service_role` no navegador e grants diretos de CRUD em `chamada_diaria` não participam. RH, GESTOR, LEITURA, pendentes, bloqueados e anônimos não podem escrever nesta etapa.

Os códigos persistidos no enum existente `codigo_chamada` são `P`, `F`, `A`, `I`, `B`, `X`, `H`, `G`, `D` e `AF`. A constraint existente `unique (colaborador_id, data)` continua garantindo um lançamento corrente por pessoa e data. A RPC só aceita colaborador na `vw_colaboradores_mensurados`: `ATIVO`, `FERIAS` ou `NOVO_ADMITIDO` ativo no sistema. Gestor e extrato ausentes não impedem chamada. `D` e `AF` são ocorrências diárias e não mudam a situação cadastral. Não há seed, lançamento automático ou bloqueio arbitrário de data futura.

## Salvar, corrigir e limpar

O mesmo comando insere ou atualiza status e observação. Observação é texto simples exibido escapado pelo React, recebe `trim`, tem limite de 500 caracteres e vira `NULL` se vazia; sem status, não é gravada. Status `NULL` limpa o lançamento corrente, inclusive observação. Gravação idêntica devolve `changed=false` e não cria auditoria. A UI mostra salvamento, confirmação ou erro; uma célula em andamento fica temporariamente desabilitada, sem travar outras linhas. Hoje e Período compartilham o snapshot local, e Atualizar relê a RPC do Supabase sem recarregar a página inteira.

Cada leitura de chamada inclui `updatedAt`. A gravação exige `expectedUpdatedAt` igual ao registro lido, ou `NULL` para inserção; versões divergentes retornam conflito HTTP 409 e não sobrescrevem alterações de outra sessão. Um lock transacional por colaborador/data serializa até a disputa por registro ainda inexistente. O timestamp de update avança monotonicamente. A auditoria protegida registra `INSERT`, `UPDATE` e `CLEAR`, estado anterior/novo, responsável e instante. Ela permanece mesmo quando o lançamento corrente é limpo; não tem grants para usuários comuns.

## Banco de horas e segurança

`G` conta somente no ciclo da medição vigente e até a data consultada. A RPC de leitura deriva `A compensar = max(dias positivos - G válidos, 0)`; um novo ciclo ignora G anterior, saldo negativo continua “A repor” e saldo zero não se torna negativo artificialmente. Corrigir/remover G restaura a pendência derivada. Nenhum comando de chamada altera `banco_horas_medicoes`, colaboradores ou a baseline. A tabela de auditoria tem RLS e nenhum acesso `anon`/`authenticated`. A função pública de escrita é `SECURITY INVOKER`; ela chama um helper `SECURITY DEFINER` em `chamada_privada`, schema não exposto pela Data API. O helper tem `search_path=''`, valida perfil em `public.perfis` e usa `auth.uid()`. `PUBLIC`/`anon` não têm `EXECUTE`; somente `authenticated` pode entrar, sujeito à validação interna de ADMIN aprovado.

Testes de escrita usam colaboradores e contas fictícios em PGlite descartável. Não são realizados lançamentos de teste em colaboradores reais. O primeiro lançamento na base oficial deve ser feito manualmente pelo ADMIN após homologação.
