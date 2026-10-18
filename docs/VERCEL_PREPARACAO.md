# Preparação da publicação na Vercel

Revisão de 18/10/2026. Projeto remoto `administrativo-cd/administrativo-cd-rh` criado, com `develop` como branch de produção. As quatro configurações sem segredo foram salvas em Production: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN` e `MONITORING_INGEST_SOURCE_IDS`. A credencial privada do Supabase e o token de ingestão aguardam a confirmação específica solicitada ao usuário; seus valores permanecem locais. Ainda não houve publicação nem teste autenticado na Vercel.

## Ambiente mínimo

Configurar somente pelos controles de ambiente do projeto, sem enviar arquivos `.env`:

| Nome | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase; necessária também durante o build. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave publicável do cliente; necessária também durante o build. |
| `APP_ORIGIN` | Origem HTTPS canônica, sem caminho ou barra final; valida mutações do navegador. |
| `MONITORING_SUPABASE_SERVICE_ROLE_KEY` | Segredo exclusivo do servidor para ingestão, fotos, reprocessamento e upload validado de anexos. |
| `MONITORING_INGEST_TOKEN` | Token exclusivo do worker, com pelo menos 32 caracteres. |
| `MONITORING_INGEST_SOURCE_IDS` | Lista explícita das fontes permitidas, separadas por vírgula. |

Não configurar `ALLOW_LOOPBACK_ORIGIN` na Vercel. `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `FIRST_ADMIN_USER_ID` pertencem ao bootstrap administrativo local quando necessário; não são requisitos do aplicativo publicado. Nunca adicionar prefixo `NEXT_PUBLIC_` a segredos.

Uma URL de preview ou alias diferente de `APP_ORIGIN` bloqueia mutações por desenho. Cada ambiente deve usar sua origem configurada; não remover a validação. A proteção adicional de deployment da Vercel também deve ser compatível com o worker: o transporte atual envia apenas o token próprio da aplicação, sem cabeçalho de bypass da Vercel.

## Build e runtime

`vercel.json` seleciona `pnpm exec next build --webpack`, como no build local validado, e duração máxima de 300 segundos para APIs. Esse valor é suportado pelo Fluid Compute atual; não garante que uma operação leve esse tempo. O worker e o assistente de importação mantêm timeout de 60 segundos. Trabalhos de reprocessamento preservam fila, lease e repetição idempotente.

Usar o preset Next.js, instalação a partir de `pnpm-lock.yaml` e uma versão de Node compatível com `engines.node` (`>=22.13.0`). A Vercel oferece Node 24.x e 22.x. Fixar a versão do gerenciador no ambiente de build evita diferenças de instalação. Não publicar `node_modules` nem um build nativo produzido no Windows: `sharp` deve ser instalado para o sistema da Vercel. `sharp`, `pdf-lib` e `exceljs` já são dependências diretas.

A rota de fotos passou a importar `sharp` diretamente, permitindo rastreamento de dependências. Nos builds isolados do Windows, o manifesto inclui a junction `node_modules` inteira; a ausência de uma entrada individual chamada `sharp` era um falso negativo, não prova de dependência ausente. A inclusão individual dos arquivos nativos deve ser conferida no build Linux da Vercel.

O worker continua no computador que possui os arquivos. A publicação da interface/API não transfere pastas locais nem cria um observador persistente na Vercel. A troca de endpoint e o encerramento do processo antigo exigem o procedimento de passagem de controle já definido para o runtime.

## Limites de transporte

A Vercel limita corpo de requisição e resposta a 4,5 MB. Os limites abaixo são em bytes, inclusive JSON UTF-8 serializado:

| Fluxo | Limite do aplicativo |
| --- | --- |
| CSV/XLSX de Banco de Horas e cadastro do relógio | 4.300.000 bytes de arquivo; 2.000 registros. |
| Envio multipart completo | 4.400.000 bytes, incluindo campos, nomes e delimitadores. |
| Ingestão JSON do worker | 4.400.000 bytes e até 500 ocorrências por lote. |
| Prévia/resultado de importação | 4.400.000 bytes serializados; sem truncar linhas. |
| Foto de ingestão | Imagem de até 2 MiB; JSON limitado a 2.900.000 bytes. |
| Anexo privado da Chamada | Arquivo de até 2 MiB; JSON limitado a 2.850.000 bytes. |
| Edição individual de Banco de Horas | JSON limitado a 16.384 bytes. |

O worker monta lotes determinísticos pela quantidade e pelo tamanho serializado, incluindo metadados, caracteres multibyte e escapes. Identidade do arquivo, chaves e hashes das ocorrências permanecem intactos. Um registro ou conjunto de metadados indivisível acima do limite é recusado antes de enviar; nenhum dado é cortado. O transporte verifica novamente o JSON antes de iniciar a requisição.

O formulário recusa arquivos maiores antes do upload e explica respostas HTTP 413 mesmo quando a plataforma não retorna JSON. A API verifica a expansão JSON antes de persistir a prévia e limita a resposta completa após acrescentar dados do banco. Uma consulta extensa orienta dividir o arquivo. Se uma confirmação já foi processada e sua resposta ficou excessiva, a mensagem informa isso, atualiza a consulta operacional e orienta conferir o histórico; não afirma que a gravação foi desfeita.

Anexos permanecem privados, autenticados e limitados ao papel/escopo autorizado. Downloads usam `Content-Disposition: attachment`, `nosniff` e `no-store`. Não há bucket público nem URL pública de documento.

## Arquivos enviados

`.vercelignore` usa uma lista de inclusão: `app`, `components`, `hooks`, `lib`, `public`, `vendor` e arquivos de configuração/build. `vendor` é necessário: `app/globals.css` importa o CSS local do shadcn. Não foram encontradas dependências locais `file:`, `link:`, `workspace:` ou patches de pacotes nas configurações atuais.

Ficam fora do upload: `.env*`, planilhas RH, `data`, `ACESSOS DEFENSE`, `relogio de ponto`, `.monitoring-worker`, `monitoramento.local.json`, `.importacao-administrativo-cd-rh`, `contexto-importado`, `artifacts`, `output`, `outputs`, `work`, scripts operacionais, diretórios de agente, testes, backups e exports. `node_modules`, `.next` e `.vercel` também não são enviados como fonte. Esta lista protege o upload do CLI; a seleção de arquivos rastreados no Git deve continuar sendo revisada separadamente.

## Evidências locais

- 83 testes em 8 arquivos passaram no ciclo final: limites, transporte, worker, importação, API, interface, miniatura e rota de foto.
- TypeScript e ESLint dirigidos passaram, incluindo a guarda de resposta e o import direto de `sharp`.
- Build Webpack final isolado terminou com código 0 em 18/10/2026 às 04:17 UTC, gerando o release `validated-i1dOqr`. O bundle da rota de fotos contém o import explícito de `sharp`; o manifesto local inclui a junction `node_modules`.
- Smoke desse release, numa porta própria encerrada ao final: saúde válida, login HTTP 200, anexos anônimos HTTP 401 e ingestão de foto sem token HTTP 401. Foram examinados 96 arquivos do cliente contra os 2 segredos configurados, sem ocorrência. Evidência local ignorada: `artifacts/isolated-build/vercel-release-smoke.json`. Nenhum runtime foi promovido ou reiniciado, e nenhuma mutação remota foi feita.
- Validação sintética PGlite aplicou 32 migrations e passou em repetição, renomeação, retomada parcial, alteração de tamanho de lote, concorrência serializada e fila. Nenhum acesso ao banco remoto.
- A fixture de expansão usa 2.000 linhas e um CSV abaixo de 4.300.000 bytes; a prévia excedente é recusada antes da RPC. As verificações não aplicam medições nem vínculos reais.

## Referências verificadas

- [Limites das Vercel Functions](https://vercel.com/docs/functions/limitations).
- [Configuração de duração](https://vercel.com/docs/functions/configuring-functions/duration).
- [Configuração de build](https://vercel.com/docs/project-configuration/vercel-json).
- [Lista de inclusão com `.vercelignore`](https://vercel.com/docs/deployments/vercel-ignore).
- [Versões Node.js](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
- Documentação local Next.js: `route.md` e `02-route-segment-config/maxDuration.md` na versão instalada.
