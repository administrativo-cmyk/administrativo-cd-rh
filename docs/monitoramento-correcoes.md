# Correções da base administrativa — 17/10/2026

Este registro cobre a seção 3 do prompt. Não representa implantação remota, importação de arquivos pessoais ou aceite autenticado em produção.

## Implementado

| Achado confirmado | Correção e evidência |
| --- | --- |
| Referência fora do período desaparecia do payload | A RPC inclui o dia de referência além do intervalo. Teste SQL seleciona setembro com uma chamada futura fora do período e confirma sua presença. |
| PUT tardio reaplicava G após GET | `hooks/use-daily-call.ts` identifica mudanças de consulta e revalida o saldo autoritativo. Teste reproduz PUT iniciado, GET já com G e resposta PUT tardia. |
| Observação apagada após falha | `components/daily-call-observation.tsx` limpa o rascunho apenas após confirmação. Testes cobrem retorno `false`, exceção de rede e nova tentativa. |
| Drawer mantinha objeto antigo | Quadro Atual e Banco de Horas guardam UUID e derivam dados atuais. Testes atualizam o registro aberto e removem acesso ao registro. |
| Saldo parcial apresentado como compensado | `lib/time-bank-selectors.ts` distingue Saldo parcial, Zerado e Em dia após G. |
| Selo incondicional de sincronização | A Chamada mostra carregamento, falha e instante da última consulta bem-sucedida em America/Sao_Paulo. |
| Falhas técnicas sem referência | Leitura/gravação geram correlação e logs com operação e código. Não registram mensagem bruta, stack, CPF, PIS, foto ou payload. |
| Datas SQL infinitas | Nova migration valida RPCs de leitura/gravação e adiciona constraints nas datas operacionais. `infinity` e `-infinity` são rejeitados; planejamento futuro finito continua permitido. |
| Hash nulo em baseline | CHECK exige hash não nulo, formato válido, datas finitas, ordem temporal e estado concluído. A lacuna não comprova duplicação histórica. |
| Hash e parsing em leituras diferentes | CLI captura bytes uma vez e entrega esse mesmo snapshot ao hash e parser. Teste substitui o arquivo original e confirma plano/hash estáveis. A releitura antes do apply apenas detecta alteração posterior. |
| Tipos incompletos | `lib/persistence/database.types.ts` inclui proveniência, perfis, auditoria e contratos das RPCs; clientes Supabase usam tipos, mantendo schemas de validação dos snapshots. |
| Inferência por fragmento de CPF mascarado | Busca administrativa aceita nome ou CPF completo exato, com ou sem máscara. Teste SQL rejeita fragmentos e texto misto com dígitos. Permissões administrativas preservadas. |

Migration criada pela CLI: `supabase/migrations/20261017165920_existing_integrity.sql`. Ela não altera nem exclui dados operacionais existentes. Dados legados inválidos causam falha de validação e exigem revisão específica antes de aplicação remota.

## Validação local executada

- 41 testes dirigidos em seis arquivos passaram.
- `npm run typecheck` passou.
- `npm run lint` passou.
- PGlite descartável aplicou as 17 migrations anteriores e a nova migration de integridade, com testes existentes e novas regressões passando. Nenhum banco remoto foi acessado.
- A primeira execução completa de testes identificou uma expectativa antiga da API, que não previa `correlationId`. A expectativa foi atualizada para o contrato novo; resultado final da suíte está no relatório geral.
- `scripts/validate-migrations.mjs` inclui as regressões desta seção e executa `supabase/tests/monitoring.sql` quando presente. A integração com a migration de Monitoramento é validada no relatório geral.

## Dependências e backlog

A validação estrita de CPF/PIS de ingestão pertence ao pipeline de Monitoramento. A normalização progressiva de CPF da interface de login não deve ser usada para interpretar arquivos.

Dashboard, Sugestão de Férias, Férias por Gestor e Mês, Top 20, Top por Gestor, Afastados e Outros, Metodologia e Configurações antigas não foram implementados por estas correções. Exportação da Chamada, recuperação de senha, Google, ações em lote e controles auxiliares continuam no backlog quando não implementados em outra entrega.

Prioridade seguinte: definir regras e persistência de férias/movimentações; completar recuperação de senha; depois desenvolver rankings e módulos analíticos com critérios de negócio aprovados. Quadro e Banco de Horas continuam consultas reais. Documentos anteriores descrevendo mocks e permissões antigas são históricos; prevalecem este registro e o relatório geral de Monitoramento.

## Aceite dirigido

1. Selecionar data com chamada persistida e período de outro mês; conferir status e indicadores do dia.
2. Salvar G enquanto outro refresh ocorre; confirmar que o saldo cai uma única vez.
3. Provocar falha/conflito ao salvar observação; confirmar rascunho preservado e retry possível.
4. Abrir drawer, atualizar dados e confirmar detalhes atuais; remover registro do escopo e confirmar fechamento.
5. Testar saldo parcial sem G, zero real e saldo compensado.
6. Buscar CPF completo e fragmentos como ADMIN/RH; somente correspondência completa deve consultar CPF.

Esses passos de interface devem ser repetidos em ambiente autenticado de homologação após aplicar as migrations autorizadas.
