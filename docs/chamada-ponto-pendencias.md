# Chamada pelo ponto e revisão de pendências — 17/10/2026

## Comportamento da interface

- A Chamada identifica a origem do registro: **Pelo ponto**, **Falta automática** ou **Revisão manual**. A origem também acompanha as células do período e o histórico do colaborador.
- **I** aparece como **Falta injustificada**; **F** continua **Folga**. A regra aprovada usa I para ausência segura com saldo até 480 minutos. Acima de 480 minutos, a chamada permanece em branco até decisão explícita do gestor. A interface não calcula nem grava essa regra por conta própria.
- A fila agrupa dias e gestores, com contagens completas do escopo permitido, independentes da página de colaboradores. Mostra presença automática, falta automática, registros manuais, decisões pendentes e bloqueios de conferência.
- O período efetivo da fila termina no dia anterior em America/Sao_Paulo e é informado na tela. Contagens vêm dessa mesma consulta limitada. Planejamento futuro permanece disponível na Chamada principal; hoje/futuro não são oferecidos para finalização.
- Abrir a fila ou revisar um dia apenas consulta. Cobertura insuficiente, saldo desconhecido, identidade divergente, escala ausente/sobreposta ou recálculo pendente aparecem como conferências necessárias.
- O drawer lista até 50 colaboradores por página. Ocorrências pendentes iniciam sem código selecionado. A decisão exige escolher a ocorrência e justificar; observações existentes são carregadas. Falha/conflito mantém o rascunho e mostra referência do erro.
- Finalizar exige resumo, confirmação de conferência e ausência de pendências/bloqueios. A ação registra a revisão, sem escolher G/I implicitamente. Usa a versão do resumo; concorrência exige atualizar antes de confirmar.
- A lista principal e a fila são atualizadas após decisões. A fila também é atualizada após alterações manuais pelo controle já existente da Chamada.
- Cartões móveis usam o avatar privado reutilizável, assim como a tabela desktop.

## Contrato e autorização

`GET /api/daily-call/pending?start&end&managerId&offset&limit` chama `daily_call_workflow('queue', ...)`. Período máximo de 31 dias. `managerId=none` representa colaboradores sem gestor; parâmetro ausente representa todo o escopo autorizado. O servidor valida o snapshot antes de exibi-lo.

`POST /api/daily-call/pending` aceita somente `resolve` ou `close`, corpo limitado, origem confiável e perfil aprovado ADMIN/RH/GESTOR. LEITURA apenas consulta. A RPC aplica o escopo real; o cliente não envia identidade de ator.

Resolve exige versões da decisão e do registro (`expectedDecisionVersion` e `expectedUpdatedAt`), ocorrência, observação e justificativa de 5–500 caracteres. Close exige data, gestor explícito, `expectedRevision` e justificativa. As respostas também são validadas; retorno vazio não é sucesso.

Ausência da RPC no ambiente (`PGRST202`/`42883`) apresenta: “A revisão da chamada ainda não está habilitada no banco deste ambiente. Solicite à administração a conclusão da instalação.” Falhas não exibem mensagens internas do banco.

## Validação desta frente

- Sete arquivos de testes UI/API/base: 46 testes passaram, incluindo instalação pendente, período efetivo e exclusão de hoje/futuro da finalização.
- Testes PGlite usam os mesmos schemas da API para validar os retornos reais de fila, resolução e finalização. Na execução dirigida inicial, 23 testes passaram, incluindo 480/481 minutos, presença tardia, preservação manual, concorrência e autorização. O relatório geral registra a contagem final após os testes adicionais do domínio.
- Typecheck e lint dirigidos passaram. Compilação de produção Webpack isolada passou em 17/10/2026, 18:12:29–18:13:22 UTC, após os ajustes de período efetivo e erro de instalação pendente. A rota `/api/daily-call/pending` e a página `/chamada-diaria` foram geradas. A cópia temporária foi removida; `.next` ativa e servidor aberto não foram alterados.
- Capturas sintéticas realizadas durante a implementação: `output/playwright/chamada/`, em 1440×1000 e 390×844. Sem overflow do documento/drawer ou erros da página; rascunho preservado após conflito simulado. O harness usa componentes reais, fixtures locais e servidor loopback, sem banco remoto ou alteração da autenticação.

Essa evidência local não substitui a instalação autorizada da migration nem o teste autenticado com os dados reais do ambiente. Nenhuma mutação remota foi feita por esta frente.

## Compilação sem interferir no servidor aberto

`node scripts/monitoring-build-validation.mjs` copia fontes e configurações para diretório temporário próprio. Dependências são acessadas por junction. A `.env.local` é copiada sem imprimir valores; logs removem valores de ambiente conhecidos. A `.next` do checkout não é usada, o servidor aberto não é reiniciado e a cópia é removida ao terminar.

O Turbopack rejeitou a junction externa à raiz nessa configuração. `node scripts/monitoring-build-validation.mjs --webpack` passou com a cópia no mesmo volume do projeto e com os estilos de `vendor/`. Logs e resultados ficam em `artifacts/isolated-build/`. Essa execução valida Webpack, sem alegar sucesso do Turbopack isolado.
