# Catálogos, escalas e sugestões de férias

Implementação local em duas migrations novas: `20261018021801_canonical_catalogs_and_planning.sql` e `20261018022234_schedule_calendar_vacation_planning.sql`. As 26 migrations anteriormente aplicadas permanecem intactas. Ativação remota depende do pacote e da validação coordenados pela frente principal.

## Catálogos canônicos

- Rotas: `/administracao/setores`, `/administracao/cargos`, `/administracao/categorias`. ADMIN/RH criam, editam, arquivam e restauram com motivo e versão consultada. O histórico integra a Auditoria central.
- Espaços, caixa, acentos e representações Unicode equivalentes resolvem o mesmo registro. IDs são estáveis; renomear atualiza a descrição das pessoas vinculadas. Nomes anteriores continuam reconhecidos como aliases e não podem virar um segundo cadastro.
- A migração guarda os valores exatos anteriores de cada colaborador em `private.employee_catalog_legacy`; `private.canonical_catalog_alias` guarda as grafias. Dados brutos e helpers não ficam expostos a anon/authenticated/service_role.
- Os seletores de colaborador usam os catálogos. O trigger mantém compatibilidade com importações antigas que enviam texto. Um catálogo arquivado não pode ser atribuído a pessoa ativa, nem por alias/importação direta. Arquivamento é bloqueado enquanto há colaboradores ativos vinculados.
- Gestor pode cancelar sua proposta de férias em rascunho/solicitada. A aprovação e as propostas já aprovadas continuam protegidas pelo servidor.

## Escalas e calendário

Página `/planejamento/escalas`, API autenticada `POST /api/schedule-planning`, RPC invoker `public.schedule_planning(action,data)`. ADMIN/RH gerem configurações; demais perfis aprovados consultam com o escopo aplicável. Gestor recebe somente pessoas da própria equipe. A API valida entrada, origem, sessão e resposta; falhas não viram sucesso vazio.

Modelos contêm horários, dias, pareamento, permissão de jornada sem intervalo e janelas de café. Não existe jornada padrão presumida no formulário. Atribuição exige pessoas selecionadas, vigência explícita de até 367 dias, motivo, versão do modelo e versão do quadro. O lote inteiro reverte se uma pessoa já possui escala sobreposta. Escalas atribuídas são cópias; alterar ou arquivar o modelo não muda lotes anteriores. Escalas individuais continuam revisáveis na Configuração operacional do Monitoramento.

Feriados/dispensas e exceções trabalhadas têm início/fim explícitos, até 31 dias por registro. Precedência: pessoa, equipe, unidade, geral. Sobreposição na mesma prioridade é rejeitada quando os registros atingem as mesmas pessoas, inclusive após transferências. Uma exceção trabalhada copia um modelo vigente e substitui os dias da semana pelo dia excepcional.

Equipe/unidade preservam os membros da criação. Renomear ou editar datas mantém essa composição; uma mudança de membros exige arquivar e recriar a exceção. Regra geral aplica-se ao conjunto geral, inclusive novas admissões. A política de sugestões usa o quadro atual, conforme declarado na tela, e não esse snapshot de calendário.

O calendário é consumido pelo input do motor e pela evidência da Chamada. Dia não trabalhado impede I automático e atraso, conserva decisão manual e P comprovado. A escala base permanece separadamente como referência para atribuir eventos: saída às 06h continua na jornada noturna anterior. Sem base no dia dispensado, uma escala vizinha única fornece somente a fronteira; não cria obrigação de trabalhar. A fronteira do início/fim da exceção cobre períodos consecutivos de dispensa. Sem evidência de jornada, tempos permanecem não apuráveis.

Salvar/arquivar/restaurar calendário e atribuir escala enfileiram a vigência afetada e os dias vizinhos D−1/D+1, que também ficam desatualizados. Editar datas inclui a vigência antiga. Somente pessoas vinculadas, com resultados ou decisões existentes são adicionadas pelo calendário; não se cria uma fila infinita de pessoas sem fonte. Cobertura ou vínculo que chegam depois consultam a escala efetiva, inclusive uma exceção trabalhada sem escala regular. Jobs futuros aguardam sua data no worker existente.

Mutações usam CAS, auditoria e bloqueios ordenados antes de jobs/revisão. A coordenação com a migration de fontes usa o advisory lock `791704`. Testes PGlite verificam atomicidade, versões e ordem estrutural; não substituem um ensaio concorrente com múltiplas conexões PostgreSQL reais.

## Sugestões de férias

Página `/planejamento/sugestoes-ferias`. RH/ADMIN cadastram critérios por vigência e escopo geral, unidade ou gestor: tempo desde admissão, duração, antecedência, percentual máximo simultâneo, mínimo de pessoas fora das férias planejadas e inclusão de solicitações na capacidade. Nenhum desses números é preenchido como regra presumida.

A consulta cobre até 90 dias e retorna até 20 primeiras janelas válidas. Denominador: pessoas ativas do quadro operacional atual da equipe (`ATIVO`, `NOVO_ADMITIDO`, `FERIAS`). Numerador: pessoas distintas com férias aprovadas e, quando configurado, solicitadas, somadas à candidata. Não infere direito adquirido, saldo legal, turnos ou disponibilidade real. Admissão desconhecida, equipe ausente ou situação não elegível bloqueiam a sugestão.

Aceitar exige escolha explícita e justificativa; recalcula a sugestão e compara a versão de pessoa, equipe, política e reservas. Uma mudança concorrente exige nova consulta. O resultado é somente `draft`: não aprova férias, não escreve Chamada e não desconta Banco de Horas. A continuação usa o fluxo existente de propostas/aprovação.

## Evidência local

- `lib/schedule-planning/integration.test.ts`: todas as migrations reais em PGlite descartável; 22 cenários de migração legada, Unicode/aliases, permissões, CAS, lote atômico, período/restauração conflitante, transferência, calendário nas fronteiras, fonte posterior, jornadas noturnas, férias e capacidade.
- `app/api/schedule-planning/route.test.ts`: origem, autenticação, campos/limites, CAS, wrapper e rejeição de resposta nula/aprovação indevida.
- `components/planning/planning-app.test.tsx`: edição com erro preserva rascunho, seleção explícita do lote, aceite não automático e controles por permissão.
- `components/administration/administration-app.test.tsx`: cancelamento próprio por gestor sem opção de aprovação; demais regressões existentes mantidas.
- `lib/monitoring/domain/seed-integration.test.ts` preserva o máximo de 18h do seed. Sem exceção de calendário, o input mantém as configurações originais; não expande artificialmente a vigência em linhas diárias.

Os testes usam dados sintéticos. Nenhuma dessas evidências afirma implantação ou mutação de dados reais.
