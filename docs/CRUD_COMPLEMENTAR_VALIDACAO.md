# Validação dos complementos administrativos

Verificação em 18/10/2026. Escopo aprovado: melhorias administrativas e operacionais, sem definição ou recuperação de senha. As seis migrations complementares foram aplicadas e auditadas no banco de produção autorizado. O runtime local e sua tarefa de logon estão ativados e verificados. A publicação Vercel continua pendente.

## Evidências locais

- TypeScript e ESLint: passaram.
- Suíte final Vitest: **751 de 751 testes em 93 arquivos passaram**.
- Banco isolado PGlite: 32 migrations, regressões de integridade e permissões passaram; nenhuma chave estrangeira sem índice.
- Pacote complementar exato: seis migrations sobre as 26 versões previamente aplicadas, em transação única. Guarda de versões rejeita base divergente e reaplicação.
- Ensaio ampliado do pacote: 15 tabelas com registros sintéticos preservadas, seis valores originais de setor/cargo/categoria com aliases, dez assinaturas agregadas iguais antes/depois. Reaplicação recusada sem alterar dados das 45 tabelas, definições, permissões, políticas ou sequências.
- Auditoria ampliada: 21 funções verificadas, acesso direto de `anon`, `authenticated` e `service_role` negado nas 22 tabelas protegidas avaliadas. Vinte e uma têm RLS; o contador privado preexistente `monitoring_revision` mantém sua proteção por ausência de grants diretos.
- Build Webpack de produção isolado: **exit 0**, release validada `validated-i1dOqr`, sem usar o diretório `.next` do servidor em execução.
- Smoke test da versão de produção: `/api/health` respondeu corretamente, login HTTP 200 e anexos sem sessão HTTP 401.
- Verificação de 94 arquivos estáticos do navegador: nenhum valor privado conhecido do ambiente encontrado.
- Revisão cruzada: corrigidos recálculo dos dias vizinhos, atribuição da saída noturna em feriados, preservação da composição histórica da equipe, bloqueio de importadores concorrentes e encerramento de processos filhos.

Relatórios locais estão em `artifacts/isolated-build`, `artifacts/complementary-validation` e `.monitoring-worker/activation-complementary-20261018`. O último diretório é privado e não deve ser publicado.

## Banco remoto antes da ativação

Projeto conferido pela sessão autorizada: `administrativo-cd-rh`, organização `Administrativo CD`, referência `kqgtnucqxqqgwdyvhvdd`, branch de produção. Consulta somente leitura confirmou:

- 26 migrations aplicadas;
- 384 colaboradores, 356 medições de Banco de Horas e nenhuma Chamada lançada;
- 45.266 eventos canônicos, 45.717 ocorrências brutas, 353 pessoas de origem e 299 fotos;
- 325 vínculos, oito configurações e quatro fontes.

`scripts/complementary-preservation-audit.sql` calcula assinaturas agregadas de dez conjuntos antes/depois, sem exportar nomes, identificadores pessoais ou fotos. A comparação exclui apenas os campos de catálogo que serão normalizados, seus novos IDs, a data de atualização do colaborador, os novos metadados de versão dos vínculos e os campos dinâmicos das fontes. A identidade das fontes permanece incluída.

## Ativação remota concluída

Após a autorização do usuário, as seis migrations foram aplicadas no projeto de produção `kqgtnucqxqqgwdyvhvdd`, elevando o histórico de 26 para **32 migrations**. A última versão é `20261018022234_schedule_calendar_vacation_planning.sql`. O manifest registra `applied: true`, aplicação em **2026-10-18T04:09:57.905957Z** e verificação em **2026-10-18T04:11:50.728Z**.

A comparação antes/depois preservou **dez fingerprints de conjuntos de dados**. A auditoria real confirmou **384 colaboradores, 356 medições de Banco de Horas, 299 fotos e zero lançamentos de Chamada**. Foram verificadas **21 funções e 22 tabelas protegidas**. O cadastro legado dos 384 colaboradores foi preservado; a normalização criou 72 registros de catálogo e 72 aliases, sem apagar as grafias originais.

Evidências privadas: `.monitoring-worker/activation-complementary-20261018/manifest.json`, `post-activation-audit.json`, `preservation-before.json` e `preservation-after.json`. Os hashes originais do pacote continuam registrados no manifest. Esses arquivos não devem entrar no Git nem no upload Vercel.

## Runtime local ativado e publicação pendente

O usuário escolheu Vercel. O projeto **`administrativo-cd/administrativo-cd-rh` foi criado**, com `develop` como branch de produção, mas **a aplicação ainda não foi publicada**. A configuração do segredo de servidor aguarda autorização específica; criação do projeto, build local e testes não comprovam deploy público.

O runtime local foi ativado na release de produção **`validated-i1dOqr`**, com bind restrito a **`127.0.0.1:3000`**. A tarefa de logon **`Administrativo CD - Importador` está `Running`**. Na verificação registrada em **2026-10-18T04:21:47.3501283Z**, o supervisor tinha PID **46284**, o servidor PID **25740** e havia **um único worker**, PID **24256**. O teste real de recuperação substituiu o worker **38032 por 24256 em 10 segundos**, sem duplicá-lo; `/api/health` retornou `ready`.

Evidência local ignorada pelo Git: `artifacts/complementary-validation/runtime-activation.json`. Os PIDs descrevem aquela verificação, não identificadores permanentes dos processos.

A interface autenticada carregou o **Quadro com 384 colaboradores** e o **Monitoramento sem estado de falha**. Na primeira página, **15 fotos carregaram e nenhuma apresentou erro**. As demais imagens usam carregamento sob demanda e não foram consideradas verificadas por essa amostra. A operação local confirmada não comprova publicação Vercel.

O arquivo do cadastro completo do relógio ainda depende da exportação pelo responsável. A implementação aceita prévia e importação por matrícula exata; não cria vínculos reais por suposição. Escalas, feriados, cobertura de fontes e critérios de férias devem ser preenchidos com as decisões operacionais do RH.
