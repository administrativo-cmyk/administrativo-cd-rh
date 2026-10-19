# Importação pela nuvem

**Estado: publicado, automação ativada e teste real de AFD legado concluído de ponta a ponta.** O commit `ad9b8fe` está publicado em [administrativo-cd-rh.vercel.app](https://administrativo-cd-rh.vercel.app), deployment `8nW5dZ6FMMpc4ZiR7QmLzwh52HpB`, estado **Ready**. A migration da fila foi aplicada no projeto Supabase autorizado `kqgtnucqxqqgwdyvhvdd`, elevando o total a **33 migrations**, com bucket privado limitado a **20 MiB**. Há **uma única tarefa Cron ativa, a cada minuto**. Nenhum processo local foi desligado por estas alterações.

A sessão autenticada ADMIN confirmou **quatro fontes e `automationReady: true`**. Saúde e login responderam HTTP 200; `/api/monitoring/cloud/run` rejeitou chamada sem credencial com HTTP 401. **849 testes e o build passaram** antes da publicação. A evidência do processamento real está registrada separadamente abaixo.

Em **18/10/2026, horário de Brasília**, o recebimento de um **AFD legado real** foi confirmado na interface às **23:16:26**. A navegação seguiu para Dashboards antes do Cron. O disparo começou às **23:17:00** e o job concluiu às **23:17:03.274**, em **uma tentativa**, com **668/668 linhas**, **2/2 lotes**, erro nulo, **um original armazenado** e resposta **HTTP 200 sem timeout**. O processamento não dependeu de manter a tela de Importação aberta.

Foi reenviado um AFD legado já importado para validar idempotência; nenhum dado novo foi introduzido neste ensaio.

A comparação com a base anterior manteve as sete contagens, todas com **delta zero**: 45.266 eventos, 45.717 ocorrências, quatro arquivos canônicos, 353 pessoas de origem, 299 fotos, 325 vínculos e 384 colaboradores. Evidência local ignorada pelo Git: `artifacts/cloud-validation/live-after.json`. **AFD ISO e Defense permanecem cobertos por testes locais; não foram exercitados neste teste real de produção.**

## Uso pelo RH ou administrador

1. Exporte o arquivo no relógio de ponto ou no Defense.
2. Abra **Monitoramento > Importação > Enviar arquivos para a nuvem** e selecione a fonte correspondente.
3. Para ponto, selecione explicitamente o formato AFD **Legado/PIS** ou **ISO/CPF**, conforme o exportador. Envie o AFD `.txt`; para acessos ou cadastros Defense, envie `.xlsx`.
4. Envie um arquivo por vez, com até **20 MiB** e nome de até 200 caracteres. Mantenha a página aberta durante envio e confirmação.
5. **Só feche a página ou desligue o computador após a confirmação do recebimento.** A fila e o processamento passam a continuar no servidor. Consulte o histórico para acompanhar conclusão ou falha.

Enquanto o servidor não confirmar `automationReady: true`, o formulário mostra **Aguardando ativação da automação no servidor** e bloqueia novos uploads. O histórico continua disponível. Depois da ativação, use **Atualizar envios**; uma resposta sem esse indicador mantém o bloqueio.

O sistema não exporta arquivos automaticamente nem acessa diretamente a API do relógio. Cada nova exportação deve ser enviada pela tela. Uma pasta no computador não se torna acessível à nuvem por esse fluxo.

Se o arquivo foi enviado, mas a confirmação falhou, use **Confirmar recebimento** ou **Confirmar envio** no histórico. Isso permite recuperar a operação sem reenviar os bytes. Arquivos já recebidos ou concluídos, com a mesma fonte, hash e versão do leitor, são reconhecidos pelo servidor. Em falhas, revise o motivo e use **Tentar novamente** quando disponível. **Cancelar** interrompe o restante do processamento e preserva registros já importados. Ações de repetição e cancelamento rejeitam versões desatualizadas do envio.

A planilha Defense Person não inclui as imagens. **As fotos já cadastradas são mantidas.** Esta entrega não importa pastas ou ZIPs de fotografias nem associa fotos automaticamente por nome.

## Processamento e proteção dos dados

- Upload assinado direto do navegador para o bucket privado `monitoramento-originais` no Supabase Storage. O arquivo original não atravessa o corpo de requisição da Vercel. Tokens temporários de upload não são gravados em logs ou armazenamento local do navegador.
- SHA-256 calculado antes do envio e conferido novamente no servidor. Tamanho, fonte autorizada e formato também são validados; uma fonte desativada ou com configuração alterada bloqueia a continuação.
- O envio guarda a configuração da fonte e o perfil AFD escolhidos. A lista permitida continua sendo `MONITORING_INGEST_SOURCE_IDS`. Identidades sem conciliação não ganham vínculo RH por suposição; a apuração mantém os critérios existentes de cobertura e evidência.
- Execução Node.js na Vercel, com máximo configurado de **300 segundos** por chamada e orçamento interno de **230 segundos** por rodada. Lotes persistidos, cursor e plano de processamento permitem continuar de onde parou sem repetir registros canônicos.
- **Supabase Cron está ativo a cada minuto**, configurado para disparar rodadas autenticadas quando há trabalho. O disparo não depende do computador nem de uma aba aberta. A frequência não é garantia de conclusão em um minuto; o teste real acima confirmou uma execução completa de AFD legado.
- O histórico distingue aguardando confirmação, na fila, processando, concluído, falhou e cancelado. A tela consulta a cada dez segundos apenas quando visível e com pendências; não sobrepõe consultas lentas.

O limite acumulado inicial é **500 MiB para originais e reservas de envio**. Arquivos efetivamente armazenados continuam contando mesmo após conclusão ou cancelamento: os originais são preservados e **não existe expurgo automático**. Reservas de envios falhos ou cancelados **sem objeto no Storage** podem deixar de consumir a cota após **três horas**, respeitando as duas horas do token de upload assinado e uma margem adicional. Isso libera reserva, sem apagar arquivo ou histórico.

Atingir o limite bloqueia novos envios e exige revisão administrativa da retenção/capacidade. Há também limites de dez envios ativos por usuário e cem no total. A retenção deverá ser revista pelo responsável antes de ampliar o uso.

## Ativação e planos

A migration da fila/bucket privado foi aplicada, as rotas e o painel foram publicados e o Cron único está ativo. A consulta autenticada retorna prontidão confirmada. **Upload, recebimento, execução do runner e conclusão de AFD legado foram verificados em produção.** As variáveis de ambiente existentes são reutilizadas; **nenhum novo segredo de ambiente foi necessário**. Tokens de disparo são temporários e não substituem as credenciais já autorizadas do servidor.

O Supabase atual está no plano **Free**. Limites de armazenamento e execução devem ser acompanhados pelo operador. Na Vercel, a documentação do **Hobby** restringe o plano a uso pessoal e não comercial; o uso administrativo da empresa exige revisão do plano pelo responsável. Esta entrega **não contrata plano, não ativa upgrade e não autoriza cobrança**. Referência oficial: [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby).

O importador local permanece ligado ao endpoint local e ao mesmo Supabase até uma passagem de controle autorizada. O teste comprovou a execução pelo Cron e pelo runner da nuvem após sair da tela de Importação. **O computador não foi desligado neste ensaio; o runtime local permaneceu intacto.**
