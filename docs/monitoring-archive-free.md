# Histórico de ponto no plano gratuito

## Situação e objetivo

Em 20/10/2026 o projeto `administrativo-cd-rh` (`kqgtnucqxqqgwdyvhvdd`) estava no plano Free, com 1.399.565.459 bytes de banco e gravações bloqueadas. O limite gratuito do banco é 500 MB. Os objetos no Storage ocupavam 32.759.465 bytes. A quota gratuita de Storage é separada: 1 GB por organização, sujeita aos demais usos e limites de transferência.

O objetivo é manter os dados recentes no Postgres e o histórico completo em arquivos privados comprimidos, sem contratar plano e sem excluir os AFDs originais. O histórico arquivado continua sendo dado pessoal; não deve entrar no Git, em buckets públicos ou em URLs permanentes.

Referências verificadas em 20/10/2026:

- [Tamanho e modo somente leitura do banco](https://supabase.com/docs/guides/platform/database-size).
- [Quota de Storage](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size).
- [Transferência do Storage](https://supabase.com/docs/guides/storage/serving/bandwidth).

## Entrega desta etapa: preparação e conferência

`pnpm monitoring:archive` prepara arquivos locais e verifica sua integridade. O comando não possui conexão com banco, upload, exclusão ou ativação automática. Ele não conclui os envios pendentes da aplicação nem reduz o banco de produção.

O pacote contém:

- Cópia gzip de cada original, preservando exatamente bytes, codificação, CRLF, cabeçalho e registros administrativos. A restauração independe da pasta de origem.
- Todos os registros normalizados em partes NDJSON gzip de até 5.000 linhas, separados por relógio, hash do arquivo e mês local. Registros sem data ou com documento inválido ficam em `unclassified`, preservados para revisão.
- O parser aceita documentos alternativos válidos por padrão, pois um relógio predominantemente CPF também pode conter PIS e vice-versa. Nenhum documento é truncado para tentar validá-lo.
- Manifesto com SHA-256 dos arquivos comprimidos e descomprimidos, tamanho, versão do parser, origem, mês e contagens.
- Conferência de cada registro arquivado contra uma nova leitura do original comprimido. O verificador rejeita objetos alterados, arquivos ausentes, repetição de linhas, caminhos externos e contagens divergentes.
- Comparação de reexportação por fonte/NSR/hash. NSRs iguais de relógios distintos permanecem separados. Payload diferente para o mesmo NSR vira conflito e impede selar o pacote. Versões de layout diferentes permanecem sujeitas à reconciliação de precisão já existente; este comparador conservador não aprova uma equivalência por conta própria.
- Leitura local do histórico por CPF/PIS e intervalo semiaberto, com referência ao arquivo e à linha. Ela não representa autorização de acesso na aplicação.

Somente `manifest.json` indica preparação concluída. `manifest.prepared.json` sem o manifesto final identifica uma preparação incompleta. `verification.json` registra explicitamente `databaseChanged=false`, `storageUploaded=false` e `cleanupAllowed=false`.

### Comandos

A configuração privada deve ficar em `artifacts/` ou `data/private/`, com caminhos absolutos, hash esperado e fonte correta. Exemplo sem dados pessoais:

```json
{
  "projectRef": "kqgtnucqxqqgwdyvhvdd",
  "asOf": "2026-10-20",
  "payrollCycles": 3,
  "files": [{
    "sourceId": "ponto-legado-cd-jk",
    "path": "C:\\pasta-privada\\AFD.txt",
    "sha256": "HASH_SHA256_DE_64_CARACTERES",
    "profile": "legacy",
    "identityType": "pis",
    "allowAlternate": true
  }]
}
```

```powershell
pnpm monitoring:archive prepare --config artifacts/arquivo-privado.json --output artifacts/historico-novo
pnpm monitoring:archive verify --archive artifacts/historico-novo
pnpm monitoring:archive reconcile --archive artifacts/historico-novo --config artifacts/arquivo-privado.json --output artifacts/conferencia-nova.json
pnpm monitoring:archive restore-originals --archive artifacts/historico-novo --output artifacts/originais-restaurados
```

Para inspecionar batidas de uma pessoa, use `history`, `--archive`, `--source`, `--identity-type`, `--identity`, `--from`, `--to` e `--output`. As datas exigem hora e fuso; o fim é exclusivo. O comando grava o resultado em arquivo privado e não imprime CPF ou batidas no terminal. O intervalo máximo é 367 dias.

Os destinos devem ser novos. O comando não sobrescreve arquivos nem remove tentativas incompletas. Não há chave de Supabase no pacote.

## Arquitetura proposta para ativação na nuvem

### Janela operacional

O padrão proposto é manter três ciclos de folha, sempre de 21 a 20. Em 20/10/2026 isso significa datas operacionais a partir de **21/07/2026**, com eventos desde **20/07/2026** para proteger jornadas noturnas. A janela está registrada no manifesto e pode ser configurada entre um e doze ciclos durante a preparação. Ela ainda não foi aplicada à produção.

Os dois AFDs completos contêm mais dados que a cobertura declarada. A presença de batidas antigas não prova que todos os dias ou equipamentos foram exportados. O arquivo não amplia a cobertura, não gera faltas retroativas e não altera banco de horas, revisões manuais, desligamentos ou afastamentos.

### Armazenamento e acesso

Criar um bucket privado dedicado, com objetos imutáveis, upload exclusivo do servidor e controle de quota antes de cada lote. O orçamento inicial do pacote é 400 MiB, abaixo da quota gratuita; o uso agregado da organização e a transferência precisam ser verificados antes da publicação. Não há armazenamento gratuito ilimitado.

O banco deve conter apenas catálogo compacto de partes/meses, hashes, origem, intervalo, contagens e versão. A consulta de histórico deve passar pelo servidor, validar o papel e o vínculo vigente do gestor com o colaborador e retornar somente as batidas daquela pessoa. A chave privada e o conteúdo de outras pessoas não podem chegar ao navegador. O leitor deve combinar os dois relógios e informar que o período foi arquivado. Apurações antigas devem ser identificadas como históricas, sem inventar cobertura completa.

Na janela operacional, manter eventos necessários aos cálculos e proveniência compacta por arquivo/linha/hash. O payload bruto repetido das ocorrências pode residir no arquivo privado, com recuperação pelo servidor. A retirada de revisões antigas e a compactação da proveniência precisam ser implementadas e verificadas juntas; apenas apagar eventos antigos pode não criar margem suficiente no plano Free. O tamanho após a reorganização precisa ser medido, sem tratar estimativa como garantia.

### Ingestão futura

Antes de gravar dados históricos no Postgres, o worker deve produzir e reler o arquivo privado, confirmar o checksum e registrar seu catálogo. Reenvios precisam consultar o índice histórico por fonte/NSR/hash. Não basta verificar apenas os NSRs ainda presentes no banco operacional.

O checkpoint dos envios já iniciados não pode ser reiniciado ou recalculado silenciosamente: o PIS possui plano de 615 lotes com cursor 475; o CPF está no cursor zero. A integração precisa preservar o hash do plano, o número total de linhas, a concessão do worker e os hashes originais. Contadores de registros arquivados e registros operacionais devem ser distintos. Uma resposta perdida não pode duplicar o lote.

O arquivamento recorrente deve rodar na nuvem e limitar as apurações automáticas à janela operacional. Arquivos originais e revisões auditadas permanecem preservados. O processo deve parar com mensagem clara antes de atingir o orçamento e nunca contratar serviço automaticamente.

## Sequência segura de recuperação

1. Confirmar projeto, plano, espaço, filas e concessões. Suspender apenas a ingestão/apuração durante a manutenção, mantendo decisões de RH protegidas. O inventário somente leitura está em `scripts/monitoring-archive-inventory.sql`.
2. Além dos AFDs, exportar **as linhas reais do banco** de eventos, ocorrências, resultados/revisões, auditoria e jobs que sairão da janela. O pacote dos AFDs não substitui esse backup: IDs, conflitos, proveniência, resultados e revisões não são integralmente reconstruíveis apenas dos originais.
3. Publicar arquivos privados e reler todos os objetos. Registrar hashes, contagens, identificadores e fronteira consistente. Testar restauração isolada e consulta de histórico com os mesmos controles de acesso da aplicação.
4. Integrar e testar o worker com catálogo histórico e idempotência. Cobrir sobreposição de exportações, conflito de NSR, falha após upload, resposta perdida, janela noturna e retomada dos dois planos existentes.
5. Somente com as etapas anteriores verificadas, retirar do banco as cópias operacionais já arquivadas e comprovadamente recuperáveis. Preservar os originais, a auditoria, a Chamada e o Banco de Horas. Não existe comando de limpeza nesta entrega.
6. Recuperar espaço físico com manutenção adequada ao espaço disponível. `VACUUM FULL` precisa de espaço adicional e bloqueia a tabela; não executá-lo indiscriminadamente no disco cheio. A alteração temporária de leitura/escrita documentada pelo Supabase serve para reduzir uso, não para forçar mais importações.
7. Medir novamente o banco. Liberar ingestão apenas abaixo do limite com margem operacional e retomar o cursor existente. Conferir os dois arquivos completos, NSRs repetidos, Chamada e Monitoramento antes de declarar a importação concluída.

## Critério de conclusão

Preparação concluída significa originais restauráveis, partes conferidas, relatório de repetição disponível e volume real medido. **Ativação** exige arquivos privados publicados e relidos, histórico acessível por papel, banco abaixo do limite, worker integrado e ambos os envios concluídos e reconciliados. Testes locais e arquivos preparados não são prova de ativação em produção.
