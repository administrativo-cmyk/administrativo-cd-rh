# Importação de dados de RH — arquitetura da baseline

> Estado: baseline inicial de 2026-09-28 aplicada e auditada no projeto oficial `administrativo-cd-rh`. Detalhes agregados em `HR_BASELINE_IMPORT.md`.

## Fontes e limite desta etapa

- `Banco de dados RH.xlsx` é a única fonte operacional prevista. O usuário deve exportar a base completa, sem filtrar saldos ou colaboradores.
- `Banco de horas.xlsx` é referência histórica opcional para comparar regras e resultados. Não entra no fluxo operacional cotidiano.
- Ambos devem permanecer em `data/private/`, ignorado pelo Git. Relatórios que contenham nome, matrícula ou qualquer dado pessoal também ficam nesse diretório. Documentação versionável conterá somente agregados.
- A Etapa 5B aplica somente gestores, colaboradores e medições da baseline. Não substitui os mocks da Chamada Diária nem importa Férias.

## Fluxo proposto

1. Ler as abas por nome e localizar cabeçalhos pelo conteúdo, sem depender da posição da aba, linha ou coluna.
2. Inspecionar valor e formato original da célula durante o parsing. Preservar a situação bruta no modelo intermediário e apontar aba/linha/matrícula no relatório privado de ocorrências.
3. Validar chaves, obrigatoriedade, duplicidades, unidades, situações, jornadas, datas e saldos. Classificar cada ocorrência como `BLOCKER`, `WARNING` ou `INFO`.
4. Cruzar Quadro, Gerente | Gestor, Banco de horas e Férias por matrícula. Ausência de linha no Banco não é saldo zero.
5. Montar um modelo intermediário por matrícula, independente de Supabase e do layout do Excel tratado.
6. Comparar com o snapshot anterior somente quando houver histórico. Na primeira carga, registrar baseline; não classificar toda a população como novos admitidos.
7. Gerar modelo intermediário ordenado e fingerprint determinístico privado, além de relatório agregado versionável. Dry-run não instancia cliente de escrita.
8. Quando disponível, comparar a referência histórica opcional, primeiro verificando a data/snapshot de cada arquivo. Períodos diferentes impedem tratar divergência individual de saldo como erro da regra.
9. No `--apply`, recalcular SHA-256, exigir data e ref oficiais, validar o mesmo plano do dry-run, confirmar organização/projeto vinculado e executar uma única função administrativa no PostgreSQL. A função valida pré e pós-condições e a chamada é uma transação atômica.

## Regras já estabelecidas no domínio

- Matrícula é chave natural textual. Não converter cegamente em número nem eliminar zeros à esquerda. Se o arquivo armazenar um número sem formato suficiente para reconstruir zeros, a perda não pode ser corrigida por inferência.
- Nome recebe somente `trim` e colapso de espaços. Não aplicar alteração de caixa ou grafia.
- `Quadro.Nome do Departamento` tem três valores observados: `CENTRO DE DISTRIBUICAO` → `CD I`, `CENTRO DE DISTRIBUICAO II` → `CD II`, e `CD FLV` → `CD FLV`. A coluna `Código da Filial` tem apenas 9 e 23; o código 9 cobre CD I **e** CD FLV, portanto não determina sozinho a unidade. Unidade desconhecida é blocker.
- O saldo canônico é inteiro assinado em minutos. Converter fração de dia do Excel multiplicando por 1440 e arredondando para minutos; aceitar também texto `HH:MM` com sinal explícito. Não inferir sinal ausente.
- Reutilizar `convertHoursToDays` em `lib/domain/bank-hours.ts`: dias inteiros pela jornada, com mais um dia somente se o restante **ultrapassar** 300 minutos; exatamente 300 não acrescenta. A regra é simétrica para saldo negativo.
- A amostra histórica descrita pelo usuário teve saldos negativos removidos manualmente. A ausência de negativos nessa amostra é `WARNING`/`INFO`, nunca `BLOCKER` nem evidência de que a exportação original não comporte negativos. Cobertura negativa deve incluir fixtures fictícias e, se disponível, exemplos do golden master.
- A metodologia e a referência mostram: padrão 7h20 (440 min), `APOIO PREVENCAO E PERDAS` 12h (720 min), `APRENDIZ`/PCD 6h (360 min) e `MENOR APRENDIZ` 4h (240 min). A função do Quadro é usada; uma diferença de jornada no golden master corresponde a mudança de função entre os arquivos (`APRENDIZ LOJA` → `MENOR APRENDIZ LOJA`), não a erro demonstrado na regra. PCD sem identificação explícita na fonte permanece uma limitação futura.
- Um colaborador ausente do novo Quadro fica sinalizado para revisão, não é excluído automaticamente. Uma linha ausente do Banco fica `SEM_EXTRATO_NO_LOTE_ATUAL`, sem converter a zero; a última medição conhecida poderá ser usada apenas em etapa futura de aplicação.
- Ausência de gestor é `WARNING`, inclusive para mensurados. O colaborador permanece no plano, unidade, setor e totais, com `gestor = null`, estado `VINCULO_GESTOR_PENDENTE` e agrupamento `Sem gestor definido`. Isso não cria gestor fictício. Na aplicação futura, `colaboradores.gestor_id` poderá ficar `NULL`; visões por gestor devem manter esse agrupamento, inclusive Top por Gestor, indicadores e férias por gestor. Chamada Diária e Banco de Horas devem incluir o mensurado sem gestor quando essas integrações forem autorizadas.
- Conflitos de nome/unidade em joins secundários são `WARNING` somente quando a matrícula única mantém a identidade inequívoca. Identidade ambígua, matrícula duplicada, unidade principal desconhecida e saldo necessário inválido são `BLOCKER`.

## Estrutura auditada e origem temporal

O bruto homologado contém `Quadro`, `Banco de horas`, `Férias`, `Metodologia` e `Gerente | Gestor`. As linhas de dados são respectivamente 384, 356, 372 e 359; a Metodologia é texto, não tabela operacional. O leitor converte durações Excel para minutos inteiros assinados. Neste export há 183 saldos positivos, 35 zero e 138 negativos.

O golden master contém 11 abas. O título de `Banco de Horas` identifica mensuração anterior em 11/09/2026 e atual em 13/09/2026; `Quadro Atual` também declara posição em 13/09/2026. A **data da extração bruta não é comprovada** por suas abas operacionais. A Metodologia reproduz texto de uma origem diferente (394 no Quadro e 383 no Banco, divergindo dos 384 e 356 efetivos). Por isso o parser não usa esse texto para datar ou contar a base bruta. Comparação individual de saldo é somente informativa.

O Quadro bruto tem 354 `Ativo`, 13 `Férias` e 17 em outras situações. Os 367 primeiros compõem a população mensurada desta amostra. O tratado tem 376 pessoas mensuradas em seu próprio período. Há 357 matrículas em comum; diferenças de integrantes e saldos não provam erro sem snapshots equivalentes.

## Data de referência

- **Data/snapshot da fonte bruta não comprovada.** A resolução usa, nesta ordem: metadado explícito `Data de referência` antes do cabeçalho em Quadro/Banco de horas, desde que válido e não conflitante; depois `--reference-date YYYY-MM-DD` informado pelo operador; senão `DATA_REFERENCIA_NAO_INFORMADA` (`BLOCKER`). A opção anterior `--as-of` segue aceita por compatibilidade. Data de modificação/download do arquivo, timestamp do Windows, Metodologia copiada e data do golden master nunca preenchem essa lacuna. Metadado da fonte válido prevalece sobre argumento divergente, com `WARNING`.
- A primeira aplicação real usou `reference_date` como baseline de `aplica_a_partir_de`, sem criar medições de períodos anteriores. O fluxo futuro de upload deve detectar a data, exigir o campo “Data de referência” quando não houver metadado confiável, mostrar dry-run e pedir confirmação antes da aplicação.

O dry-run homologado para **2026-09-28** tem **0 blockers, 50 warnings e 67 infos**. Entre os warnings estão 26 sem gestor (9 mensurados), 9 conflitos de unidade entre Quadro e aba de gestores, 1 conflito de nome no Banco, 12 mensurados sem extrato e 1 linha de gestor órfã. As 50 linhas de Férias sem Quadro são informativas. O Quadro é autoridade da unidade cadastral; divergências não são escondidas.

O arquivo aplicado foi identificado pelo SHA-256 completo, verificado imediatamente antes da escrita. Uma futura tela “Pendências de Dados” pode reunir gestor pendente, conflitos de unidade/nome e sem extrato, sem bloquear a população válida; ela não foi implementada.

## Persistência da primeira baseline

O banco reutiliza as três `unidades` e cria 32 `gestores`, 384 `colaboradores`, 356 `banco_horas_medicoes` e um `lotes_importacao`. O hash, data, status, timestamps e warnings agregados ficam no lote; nenhuma planilha ou caminho local é persistido. A função `private.aplicar_baseline_rh` não é executável por `anon`, `authenticated` ou `service_role`. A migration adiciona uma unicidade de baseline concluída por data; uma segunda tentativa retorna `BASELINE_ALREADY_APPLIED`, sem duplicar dados. Qualquer erro durante a função reverte lote, gestores, colaboradores e medições. O arquivo SQL temporário do apply fica em `data/private/` somente durante a chamada e é removido em seguida.

## Limite desta entrega

Esta baseline não integra a Chamada Diária ao banco, não remove mocks, não implementa Férias e não altera Auth. Uma próxima etapa deve tratar o consumo operacional e os warnings pendentes separadamente.
