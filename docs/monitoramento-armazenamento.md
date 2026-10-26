# Armazenamento de fotos e cálculos

As miniaturas permanecem em `monitoring_photos`. As fotos do zoom são arquivos JPEG privados no bucket `monitoramento-fotos`, identificados pelo SHA-256 dos próprios bytes. A mudança de armazenamento não recomprime as fotos existentes.

Os endpoints de foto autorizam o colaborador pela RPC existente antes de buscar o arquivo. O servidor confere tamanho e SHA-256; o navegador recebe somente a imagem, com `private, no-store`. Uma policy restritiva impede acesso direto ao bucket por `anon` e `authenticated`, mesmo quando outra policy permite acesso genérico a arquivos.

Novas fotos são enviadas sem sobrescrita e baixadas novamente para conferência antes de gravar a referência no banco. Se a migration ainda não estiver disponível (`PGRST202`), a ingestão continua usando o protocolo anterior. Outros erros de banco interrompem a operação.

## Publicação e migração dos registros existentes

1. Aplicar `20261026122621_monitoring_photo_storage_and_retention.sql`. A migration adiciona colunas, funções e o bucket; não remove imagens existentes.
2. Publicar o código. Conferir a capacidade `photoStorage: true` no GET autenticado de `/api/monitoring/ingest/photo`.
3. Consultar o estado com o script abaixo, sem `--apply`.
4. Executar a transferência com `--apply` e a URL confirmada da aplicação publicada.

```powershell
node --env-file=.env.local --experimental-strip-types scripts/monitoring-photo-storage.ts --project kqgtnucqxqqgwdyvhvdd
node --env-file=.env.local --experimental-strip-types scripts/monitoring-photo-storage.ts --project kqgtnucqxqqgwdyvhvdd --apply --app-url https://administrativo-cd-rh.vercel.app
```

O script exige correspondência entre projeto e URL do Supabase. Cada imagem ganha uma cópia local em `artifacts/photo-storage/`, que permanece ignorada pelo Git. O arquivo remoto é relido e conferido antes da atualização condicionada à versão da foto. Mudanças concorrentes interrompem a transferência daquela versão. Reexecutar o script retoma as fotos ainda pendentes.

A conclusão exige `pending: 0`, preservação das contagens e dos hashes das miniaturas e das fotos ampliadas. Os recibos e arquivos de cópia contêm dados privados e não devem ser publicados. A exclusão dos bytes inline só ocorre na RPC de commit após a conferência; nenhuma rotina apaga objetos do Storage.

## Compactação contínua

A rotina existente mantém resumos consultáveis no banco e detalhes comprimidos no bucket privado de histórico. A fila alterna páginas de detalhes e de retenção, evitando que um histórico extenso atrase indefinidamente os cálculos. Resultados que já serão arquivados pela retenção não recebem uma segunda cópia de detalhes.

Resultados ativos ainda não compactados tornam a manutenção elegível na próxima rodada, respeitando o intervalo mínimo de um minuto e o modo de manutenção. A janela continua sendo o ciclo atual e os dois anteriores, com as proteções existentes para decisões manuais, banco de horas, arquivos originais e conflitos.

Depois da transferência e da compactação, medir novamente `pg_database_size` e `pg_total_relation_size`. O espaço liberado por UPDATE/DELETE pode permanecer alocado e ser reutilizado. Qualquer reescrita física exige conferência das filas, das transações ativas e dos recibos; não é executada automaticamente pelo script de fotos.
