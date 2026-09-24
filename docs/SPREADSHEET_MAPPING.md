# Mapeamento conceitual da planilha

## Quadro Atual

Alimenta `unidades`, `gestores` e `colaboradores`. Blocos por gestor e posicoes de celula nao fazem parte do modelo. O colaborador e identificado internamente por UUID e externamente por matricula unica.

Situacoes fora da mensuracao continuam em `colaboradores`; apenas a view `vw_colaboradores_mensurados` as exclui das consultas operacionais.

## Banco de Horas

Cada data de apuracao gera uma linha em `banco_horas_medicoes`. Uma nova importacao cria nova baseline e nunca altera medicoes anteriores.

- `data_medicao`: quando a posicao foi apurada.
- `aplica_a_partir_de`: primeiro dia pertencente ao novo ciclo.
- `jornada_horas_dia`: snapshot da jornada usada.
- `saldo_minutos`: saldo assinado e sem perda de precisao.

O periodo do ciclo e inclusivo em `aplica_a_partir_de` e exclusivo na proxima baseline. Assim um G na mesma data pertence ao ciclo indicado explicitamente pela data efetiva.

## Chamada Diaria

Cada celula diaria da planilha vira uma linha em `chamada_diaria`. Nao existem colunas `dia_01`, `dia_02` etc. A restricao unica `(colaborador_id, data)` impede duas chamadas principais no mesmo dia.

O codigo G reduz apenas a pendencia positiva do ciclo da baseline. G anteriores ao `aplica_a_partir_de`, ou a partir da baseline seguinte, nao sao reutilizados.

## Importacoes futuras

Excel, Google Sheets ou relatorios poderao criar um `lotes_importacao` e relacionar as linhas processadas. Esta etapa nao implementa leitura, upload ou sincronizacao.
