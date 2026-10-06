# Auditoria agregada da população da Chamada Diária — Etapa 5C.1

Referência da fonte: `Banco de dados RH.xlsx`, 2026-09-28. Conferência remota somente de leitura no projeto oficial `kqgtnucqxqqgwdyvhvdd` em 2026-10-06. Nenhum dado pessoal ou linha individual da fonte está reproduzido aqui.

| Indicador | Antes | Depois |
| --- | ---: | ---: |
| Quadro / colaboradores persistidos | 384 | 384 |
| População operacional na view e na RPC | 367 | 367 |
| Excluídos legitimamente | 17 | 17 |
| Excluídos indevidamente corrigidos | 0 | 0 |
| Operacionais com medição | 355 | 355 |
| Operacionais sem extrato | 12 | 12 |
| Operacionais com gestor | 358 | 358 |
| Operacionais sem gestor | 9 | 9 |
| Saldo positivo / zero / negativo entre operacionais | 183 / 34 / 138 | 183 / 34 / 138 |
| Registros em `chamada_diaria` | 0 | 0 |

Os 17 excluídos foram auditados individualmente em memória contra a fonte privada e o banco. Motivos agregados: afastamento previdenciário 11, acidente de trabalho 2, outra situação de afastamento (`Outros`) 2, licença-maternidade 1 e aviso prévio 1. Não houve situação desconhecida nem exclusão indevida na baseline. A metodologia da fonte exclui expressamente essas cinco categorias da Chamada. O ponto de exclusão é a cláusula de situação em `vw_colaboradores_mensurados`; a RPC usa essa view e o repository/UI não filtram adicionalmente por situação, gestor ou extrato.

Os 354 `ATIVO` e 13 `FERIAS` persistidos estão integralmente na view e na RPC. A falta de gestor ou medição não exclui colaborador operacional. A primeira baseline não usa histórico anterior para decidir se alguém entra na população. O enum e a view já aceitam `NOVO_ADMITIDO`; o parser local foi alinhado para reconhecer descrições explícitas dessa situação em futuras cargas. Isso não muda a baseline atual nem autoriza reimportação. Uma descrição de situação desconhecida continua gerando `BLOCKER` no dry-run, em vez de exclusão silenciosa.

Nenhuma migration ou alteração remota foi necessária. A baseline permaneceu em 384 colaboradores, 356 medições, 32 gestores e 1 lote. A Chamada Diária continua somente leitura; a edição de status e observações permanece fora do escopo até a Etapa 5D.
