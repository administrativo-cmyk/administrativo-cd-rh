# Complementos administrativos e operação contínua

Escopo autorizado: concluir os CRUDs e melhorias operacionais, sem alterar definição ou recuperação de senha. As migrações aplicadas anteriormente permanecem imutáveis.

## Fluxos

- Cadastros canônicos de setores, cargos e categorias com arquivo/restauração e histórico. Valores legados são preservados na migração.
- Escalas reutilizáveis, atribuição por equipe e calendário de feriados/exceções incorporado à apuração. Alterações manuais da Chamada continuam preservadas.
- Sugestões de férias por critérios configuráveis do RH e capacidade da equipe. Aceitar uma sugestão cria rascunho; aprovação continua explícita.
- Vínculos revisáveis entre matrícula RH e identidades de origem, com motivo, versão e vigência. Importação do cadastro do relógio exige matrícula exata e prévia dos erros.
- Lotes recorrentes de Banco de Horas com prévia por linha, validação e controle de repetição.
- Chamada em lote com prévia, versão consultada e aplicação atômica. Evidências privadas por pessoa/data, com validação de arquivo e quotas incluindo arquivados.
- Notificações operacionais e filtros, além de ações de leitura em lote.
- Histórico central em `/administracao/auditoria`, restrito a ADMIN/RH. Histórico de usuários e preferências/avisos exclusivo ADMIN. CPF, PIS, tokens e conteúdo binário não são expostos.

## Cadastro da pasta neste computador

A tela de fontes configura metadados. Ela não concede acesso ao disco de um computador remoto. Execute a prévia local, depois acrescente `--apply` para confirmar:

```powershell
node --experimental-strip-types scripts/monitoring-register-source.mjs --id ponto-legado-cd-jk --root 'relogio de ponto'
```

Para fonte nova, informe também `--kind`, `--namespace` e, em AFD, `--afd-profile legacy|iso`. Para fotos, `--photo-root`. Pastas fora do projeto exigem `--allow-external-root` explícito. A ferramenta preserva IDs existentes, cria backup privado e atualiza a configuração e a allowlist local. Não confirma identidade do equipamento nem cobertura sem evidência operacional.

Na hospedagem remota, a allowlist do servidor precisa conter os mesmos IDs autorizados. Token e credencial privada ficam somente no servidor/importador, nunca no navegador.

## Reinicialização automática local

```powershell
powershell -NoProfile -File scripts/install-monitoring-runtime.ps1
powershell -NoProfile -File scripts/install-monitoring-runtime.ps1 -Apply
```

A primeira execução mostra a prévia. A segunda registra uma tarefa exclusiva deste projeto no logon do usuário atual. O computador precisa estar ligado e o usuário conectado. O supervisor reinicia somente processos que ele criou. Porta ocupada por outro sistema não é encerrada. Estado e eventos ficam em `.monitoring-worker/runtime`, sem credenciais nos registros.

Um build validado é preparado com `node scripts/monitoring-build-validation.mjs --webpack --retain-runtime`. O arquivo `artifacts/isolated-build/runtime-release.json` identifica a versão. A promoção é explícita em `.monitoring-worker/runtime/active-release.json`; não troca automaticamente uma aplicação em uso. Sem versão promovida, o supervisor aguarda uma API disponível e não inicia um servidor de desenvolvimento. Um bloqueio de processo impede dois importadores de usar o mesmo estado, inclusive quando um deles foi iniciado manualmente.

O servidor gerenciado escuta somente `127.0.0.1`. A aceitação de origem HTTP local exige a opção interna `ALLOW_LOOPBACK_ORIGIN=1`, adicionada somente pelo supervisor. A hospedagem pública mantém exigência de HTTPS e `APP_ORIGIN` explícita.

## Ativação e entradas pendentes

`scripts/prepare-complementary-activation.mjs` gera um pacote novo a partir das 26 migrações já aplicadas. A transação recusa uma base divergente e não sobrescreve pacotes aplicados. Validação local, ativação do banco, teste autenticado e publicação são etapas verificadas separadamente.

Os arquivos reais do cadastro de usuários do relógio ainda precisam ser exportados pelo responsável. Critérios de férias, escalas e cobertura das fontes precisam refletir decisões do RH; a implementação não inventa esses dados.
