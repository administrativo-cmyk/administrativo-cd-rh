# Chamada Diária — leitura real (Etapa 5C)

## Fonte e repository

O runtime da rota `/chamada-diaria` (e da rota legada `/`) usa `SupabaseDailyCallRepository`. A página e o endpoint `GET /api/daily-call` chamam o repository no servidor com o cliente Supabase SSR da sessão autenticada. Os componentes recebem apenas o snapshot autorizado e não fazem consultas diretas ao Supabase. `MockDailyCallRepository` e os 52 colaboradores fictícios permanecem exclusivamente como fixtures/testes, sem fallback no runtime nem rota pública de preview.

O repository usa uma única RPC `public.ler_chamada_diaria(data, inicio, fim)`. A função agrega `public.vw_colaboradores_mensurados`, a última medição com `aplica_a_partir_de <= data` e as chamadas existentes no período (máximo de 31 dias). A população é a da view operacional: colaboradores ativos no sistema em situação `ATIVO`, `FERIAS` ou `NOVO_ADMITIDO`. A função é somente leitura, sem N+1 de requisições HTTP por colaborador.

## Campos e regras

O retorno traz apenas id interno, matrícula, nome, unidade, setor, função, situação, gestor, admissão, snapshot da medição (data, vigência, jornada, saldo em minutos/dias, pendência/repor/G) e chamadas do período (data, código e observação). CPF, dados de Auth, e-mail técnico e campos administrativos de perfil não são retornados. A UI não registra nomes ou matrículas em logs.

Medição ausente é `null` e aparece como **Sem extrato**, nunca como 0h/Em dia. Saldo zero real mantém medição e aparece como 00:00/Em dia. O cálculo de dias usa a função de domínio SQL `private.converter_saldo_minutos_em_dias` com a jornada persistida na medição; o frontend não infere jornada pela função do colaborador. A última medição válida na data selecionada abre o ciclo. Apenas `G` lançado desde essa vigência e até a data selecionada reduz a quantidade **A compensar** positiva; saldo negativo mantém **A repor**. Nesta etapa, nenhum `G` ou presença é criado automaticamente. Datas anteriores à primeira medição ficam sem extrato histórico.

Gestor ausente permanece na população e no agrupamento/filtro **Sem gestor definido**. As unidades estruturais são CD I, CD II e CD FLV; contagens, gestores e colaboradores vêm do snapshot real. Busca usa somente nome ou matrícula. A grade Hoje exibe **Não lançado** quando não há registro, e a grade Período mantém células vazias. Métricas dependentes de chamada não simulam presença.

## Segurança temporária

A migration `20261005175821_daily_call_admin_read_only.sql` cria somente a RPC de leitura. A função é `SECURITY DEFINER` com `search_path` vazio, exige `auth.uid()` e perfil `APROVADO/ADMIN`, revoga execução de `PUBLIC`/`anon` e concede apenas `EXECUTE` a `authenticated` (com validação interna de papel/status). Nenhum `SELECT` amplo nas tabelas/views e nenhum privilégio de `INSERT`, `UPDATE` ou `DELETE` foi concedido. O endpoint reforça a autorização no servidor e responde sem cache privado; falhas mostram erro, jamais mock. A rota continua protegida pelo fluxo Auth existente. A matriz definitiva de visibilidade RH/GESTOR/LEITURA permanece pendente.

A UI está em modo somente leitura: controles de lançamento e observação ficam não interativos; não há rota/método de escrita nesta etapa. O próximo passo, somente após homologação explícita, é definir autorização por papel/unidade/gestor e implementar escrita de chamada em etapa separada.

## Homologação

Testes locais usam apenas dados fictícios. Antes de considerar a etapa concluída, aplicar a migration **somente** ao projeto oficial `administrativo-cd-rh` (`kqgtnucqxqqgwdyvhvdd`), auditar Advisors e reconciliar agregadamente com a baseline de 2026-09-28: 384 colaboradores totais, 356 medições, 1 lote, 367 mensurados, 355 mensurados com medição, 12 mensurados sem extrato, 9 mensurados sem gestor e 0 chamadas. Confirmar 0 chamadas após a migration. A inspeção visual de nomes reais deve ser feita apenas pelo ADMIN autenticado, sem screenshot versionada.

Em 2026-10-05, após a reativação manual, o CLI confirmou o ref oficial como `ACTIVE_HEALTHY` em `sa-east-1`. A baseline foi reconciliada por consultas agregadas antes da migration: 1 usuário Auth, 1 perfil ADMIN aprovado, 3 unidades, 32 gestores, 384 colaboradores, 356 medições, 1 lote `BASELINE_RH` concluído e 0 chamadas. Na população operacional: 367 colaboradores, 355 com medição, 12 sem extrato e 9 sem gestor. As 356 medições totais têm 183 saldos positivos, 35 zero e 138 negativos. A RPC retornou os 367 operacionais, incluindo 183 positivos, 34 zero e 138 negativos; a diferença de um saldo zero é de colaborador fora da população operacional.

O dry-run remoto listou apenas a migration `20261005175821_daily_call_admin_read_only.sql`, aplicada exclusivamente ao ref oficial com sincronização do Vault desabilitada. A função foi testada sob papel `authenticated` com contexto temporário do ADMIN aprovado em transação somente leitura: 367 registros, nenhuma chave CPF/Auth/e-mail e 0 chamadas. Usuário fictício sem perfil recebeu `42501`; `anon` não tem `EXECUTE`. A chamada permaneceu com 0 registros após os testes. Os Advisors não apontaram erro; o aviso de função `SECURITY DEFINER` executável por `authenticated` é intencional e mitigado pela validação interna de perfil. O aviso de proteção de senhas vazadas desabilitada é preexistente e não foi alterado nesta etapa. A inspeção visual com nomes reais continua reservada ao ADMIN autenticado, sem captura versionada.
