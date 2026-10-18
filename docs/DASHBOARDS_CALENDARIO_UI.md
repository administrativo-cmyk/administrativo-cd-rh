# Dashboards separados e calendário — validação local

Data: 17/10/2026. Trabalho local; nenhuma escrita em banco remoto, publicação ou commit nesta frente.

## Entrega

- `/dashboards`: quatro entradas independentes, sem misturar indicadores operacionais.
- `/dashboards/monitoramento`, `/dashboards/chamada-diaria`, `/dashboards/banco-de-horas` e `/dashboards/quadro-atual`: autenticação no servidor, dados reais, filtros de período/data, unidade, gestor e colaborador; exportação CSV com os filtros aplicados; gráficos com valores legíveis e tabela ordenável/paginada, apresentada em cartões no celular.
- Falha de consulta mantém o último painel identificado como anterior e preserva o filtro digitado. Respostas antigas não substituem consultas novas. Valor indisponível permanece distinto de zero; percentuais exibem denominador.
- `/planejamento/calendario`: mês, gestor, unidade, situação e busca; períodos que atravessam o mês são incluídos; contagens diárias e mensais usam pessoas únicas. Apresentação mensal no desktop e agenda/seletor de dia no celular, com detalhes de cada período.
- O calendário só publica contagens depois de carregar todas as páginas de férias. Confere `datasetVersion`, total e IDs únicos entre páginas. Usa exclusivamente programações não arquivadas e opções do escopo autenticado.
- A gestão de propostas, edição, aprovação, arquivamento e restauração continua em `/planejamento/ferias`, acessível por link funcional. Não há ação fictícia de editar uma linha nem criação automática de férias.

## Evidência

`npx vitest run components/dashboards/dashboard-app.test.tsx components/planning/vacation-calendar.test.tsx components/administration/administration-app.test.tsx components/workspace/workspace-apps.test.tsx`: **25 testes passaram**.

Casos cobertos: nulo/zero/duração negativa; consulta concorrente; erro e preservação de rascunho; exportação dos filtros aplicados; período inválido; paginação completa de 501 programações; alteração de versão/total e duplicação; interseção entre meses; pessoas únicas; falha inicial sem totais inventados; CAS administrativo e de preferências/avisos; leitura sem mutações; gestor sem aprovação; restauração de férias por ADMIN/RH e autor GESTOR de rascunho/solicitação, com negativa para aprovado e terceiro.

Typecheck e ESLint dos arquivos desta frente passaram. Os testes usam dados sintéticos controlados apenas no ambiente de teste.

QA CUA autenticado no `localhost:3000`:

- Quadro Atual: 384 cadastros, 367 operacionais; filtro CD II retornou 43.
- Banco de Horas: 356 com extrato e 28 sem extrato, cobertura 92,71%. CSV real salvo pelo navegador com 3.135 bytes.
- Chamada: 367 pessoas sem marcação e 0 marcações na data final; texto distingue ausência de lançamento de falta.
- Monitoramento: 384 pessoas, 0 resultados e 384 sem resultado; tempos e percentuais sem denominador exibem `Não apurável`.
- Largura móvel de 390 px: nenhum overflow horizontal nos quatro painéis; os dados tabulares recebem apresentação própria para celular.
- Busca do cabeçalho por “férias” retornou os dois destinos corretos e abriu o calendário.
- Calendário consultou a API real e mostrou indisponibilidade de instalação, sem mostrar números fictícios, porque a migration administrativa nova ainda não estava aplicada no ambiente remoto.
- Configurações abriu na URL de preferências e manteve salvamento desabilitado com erro real de instalação. O sino abriu Notificações; a caixa e a administração de avisos exibiram indisponibilidade, e `Criar aviso` permaneceu desabilitado.

Capturas em `artifacts/dashboards/`: Quadro, Banco de Horas, Chamada e Monitoramento, desktop/celular; busca, calendário, configurações e notificações com instalação pendente.

## Limites reais

- Banco de Horas usa extratos e dias do ciclo; não apresenta saldo líquido em horas inventado a partir dos dias G.
- Chamada usa lançamentos persistidos, não infere falta de campos vazios. Indicadores do cartão usam a data final; série e tabela usam o período.
- Monitoramento não estima produtividade, cobertura, presença ou tempo sem evidência. Resultados ainda inexistentes permanecem indisponíveis.
- Quadro, férias e demais recortes usam a lotação cadastral atual; não reconstituem o histórico de gestores e unidades.
- Calendário não calcula direito adquirido, saldo de férias ou equipe disponível. Seu quadro ativo é contexto cadastral atual, não capacidade operacional diária.
- Operações administrativas bem-sucedidas no banco remoto não foram testadas nesta frente; os fluxos de erro e os contratos de mutação foram verificados localmente.
- Houve duas transições de navegação Next dev que permaneceram em `Rendering…`; abertura direta/nova aba funcionou. Não foi provada a causa do comportamento transitório. Não houve reinício nem alteração do runtime nesta frente.

## Repetição da navegação — 17/10/2026, 21h56 (São Paulo)

Em nova aba autenticada, foram repetidas duas navegações por controles da interface:

- Chamada Diária → Monitoramento: URL mudou em 552 ms; painel completo confirmado até 6,1 s após o clique, incluindo o intervalo entre ferramentas. O estado `Rendering…` encerrou normalmente, com os 384 colaboradores e os valores indisponíveis esperados.
- Menu do usuário → Preferências: URL mudou em 1,34 s; consulta encerrada até 10 s, incluindo o intervalo entre ferramentas. A tela mostrou o erro de instalação já esperado e preservou os controles de salvamento desabilitados; não permaneceu em `Rendering…`.

O console da aba não registrou avisos nem erros nas duas transições. O problema anterior não se reproduziu neste recorte; isso não comprova que compilação ou HMR tenha sido sua causa. Não foram executados reinício, escrita remota ou novos testes amplos. Logs do processo Next não foram consultados nesta repetição.

## Consulta autenticada após ativação — 17/10/2026, 22h56 (São Paulo)

Após a confirmação da aplicação das quatro migrations, o QA CUA foi repetido em aba própria no Chrome autenticado. As indisponibilidades históricas acima foram superadas nas rotas verificadas:

| Tela | Evidência real |
| --- | --- |
| Administração · Colaboradores | 384 cadastros, paginação de 25; formulário existente abriu com unidade, gestor, situação, jornada e motivo. |
| Administração · Unidades | 3 cadastros ativos; formulário de edição abriu com código, nome e motivo. |
| Administração · Gestores | 32 cadastros; formulário existente abriu com nome, unidade de referência e motivo. |
| Administração · Medições do Banco de Horas | 356 medições, paginação de 50; edição exibiu extrato existente e preservação da origem importada. O histórico consultado informou corretamente ausência de alterações administrativas, sem erro de consulta. |
| Planejamento · Férias | 0 programações; formulário de proposta carregou colaboradores reais, datas, etapa e motivo. |
| Planejamento · Calendário | Consulta completa de 0 programações; 0 pessoas aprovadas, 0 solicitações e pico 0. Quadro cadastral de 384 pessoas; filtro CD II reduziu a referência para 43. |

Todos os formulários foram fechados sem preencher nem salvar. Nenhum cadastro, proposta, medição ou histórico foi alterado. O console da aba permaneceu sem avisos ou erros. Esta evidência comprova leitura e abertura de formulários no ambiente conectado; não comprova mutações remotas, que ficaram fora do escopo desta validação.

Capturas locais: `artifacts/dashboards/ativacao/unidades.jpg`, `banco-historico.jpg` e `calendario.jpg`.

## Análises autenticadas — 17/10/2026, 23h00 (São Paulo)

Uma consulta por rota, com referência em 17/10/2026 e todos os filtros no escopo do ADMIN, confirmou conteúdo final sem falha de carregamento:

| Rota | Resultado observado |
| --- | --- |
| `/analises/top-20-banco-horas` | 384 colaboradores; 356 com extrato, 28 sem extrato e cobertura de 92,71%. Crédito medido de 3.488h05 e débito medido de 3.789h22; 425 dias a compensar e 491 a repor. Rankings com 20 dos 183 créditos e 20 dos 138 débitos; tabela com 40 registros. |
| `/analises/top-por-gestor` | Mesmos totais globais de extratos e dias, distribuídos em 33 grupos de gestor; tabela carregada com paginação. |
| `/analises/afastados-e-outros` | 384 cadastros; 17 fora do quadro da Chamada (4,43%), zero inativos no sistema e 17 linhas na tabela. A interface esclarece que o percentual não é absenteísmo. |
| `/analises/metodologia` | Conteúdo completo de fontes, escopo, Banco de Horas, Chamada, Monitoramento, situações cadastrais e códigos. Explicita F = Folga, I = Falta injustificada, ausência de marcação distinta de falta e medidas indisponíveis distintas de zero. |

Navegação pelos links da interface concluída nas quatro rotas, sem permanência em `Rendering…`. Console da aba sem avisos ou erros. Nenhuma escrita remota ou teste adicional executado.

Capturas em `artifacts/dashboards/ativacao/`: `analise-top20.jpg`, `analise-gestores.jpg`, `analise-afastados.jpg` e `analise-metodologia.jpg`.
