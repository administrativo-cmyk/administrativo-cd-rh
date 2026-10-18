export const methodologySections = [
  {
    id: "sources", title: "Fontes e escopo",
    paragraphs: [
      "Os painéis consultam os mesmos registros persistidos usados nas telas operacionais. Nenhum indicador recebe dados de demonstração quando a fonte falha.",
      "Gestores visualizam o escopo de colaboradores permitido ao seu perfil. Filtros de unidade, gestor ou busca reduzem esse conjunto; não concedem acesso a outras equipes. Exportações seguem a mesma autorização.",
      "Quadro Atual usa o cadastro e a lotação atuais. Consultar um saldo antigo não reconstitui o gestor, unidade ou situação cadastral daquela época.",
    ],
  },
  {
    id: "bank", title: "Banco de Horas e rankings",
    paragraphs: [
      "Saldo medido é o valor em minutos do extrato aplicável à data consultada. Crédito soma apenas saldos positivos; débito soma apenas saldos negativos. Eles não se anulam. No dashboard, débito aparece como magnitude; nos rankings, preserva o sinal negativo.",
      "Top 20 seleciona até 20 pessoas por sinal após aplicar os filtros. Zero e sem extrato ficam fora do ranking. Os cartões usam todo o recorte; tabela e CSV do Top 20 mostram as mesmas até 40 pessoas. Empates usam nome, matrícula e identificador estável.",
      "Dias a compensar, a repor e G usados vêm do ciclo vigente. A conversão existente conta jornadas inteiras e acrescenta um dia quando o restante ultrapassa cinco horas, preservando o sinal. G consome dias do ciclo positivo. Não se subtrai automaticamente oito horas do saldo medido para apresentar um saldo líquido fictício.",
      "Cobertura de extratos = pessoas com medição aplicável / pessoas filtradas. Sem extrato não é saldo zero. Equipe sem qualquer extrato recebe Não apurável nos totais de saldo; extrato conhecido de zero recebe zero.",
      "Totais por gestor agrupam pelo vínculo cadastral de gestor, mesmo com nomes iguais. Sem gestor fica separado. Totais de equipes de tamanhos diferentes não medem desempenho; use colaboradores e cobertura como contexto.",
    ],
  },
  {
    id: "daily", title: "Chamada Diária",
    paragraphs: [
      "Presente significa código P salvo. Preenchimento da Chamada = registros com qualquer código / pessoas do quadro filtrado na data final. Não é taxa de presença. Campo vazio permanece Sem marcação e não é contado como falta.",
      "O quadro da Chamada exige cadastro ativo no sistema e situação ATIVO, FÉRIAS ou NOVO_ADMITIDO. Dias anteriores à admissão conhecida são excluídos. Admissão não informada permanece explicitada como limite da leitura histórica.",
      "P automático exige batida válida, identificação conciliada e vínculo vigente. Acesso facial isolado não comprova presença de ponto. A falta automática usa I somente quando o dia esperado já terminou e há escala, identidade, cobertura e saldo confiáveis, com saldo de até oito horas. Acima de oito horas, a decisão fica para o gestor. Lançamento manual é preservado.",
      "F representa Folga; I representa Falta injustificada. Férias, atestado, afastamento e falta são códigos distintos. Um arquivo parcial ou uma fonte sem cobertura não autoriza preencher faltas por inferência.",
    ],
  },
  {
    id: "monitoring", title: "Monitoramento e cobertura",
    paragraphs: [
      "Os tempos vêm de jornadas e eventos de acesso conciliados. A janela observada considera períodos de trabalho apuráveis; intervalos de descanso não viram tempo fora da operação. Uma transição só sustenta o estado quando há mapeamento e evidência válidos.",
      "Ausência de evento, leitor sem direção confiável ou lacuna de cobertura não prova permanência dentro ou fora de uma área. Valores não apuráveis permanecem separados de zero. Áreas como refeitório e perímetro podem se sobrepor; suas durações não devem ser somadas como categorias exclusivas.",
      "Taxa de atraso = jornadas com atraso superior a 900 segundos / jornadas com atraso apurável e elegível. Exatamente 15 minutos não entra como atraso. Exclusão de outro indicador não retira automaticamente uma jornada do denominador de atraso.",
      "Resultados desatualizados não entram nas somas de tempos. Pessoas sem apuração não equivalem a jornadas completas nem a todos os dias esperados do período. O painel agrega o recorte completo, com verificação de versão entre páginas; se exceder o limite, exige um filtro menor.",
      "Tempos de acesso e posição em ranking não medem produtividade, qualidade do trabalho ou desempenho individual.",
    ],
  },
  {
    id: "workforce", title: "Afastados e outros",
    paragraphs: [
      "A análise lista cadastros fora do quadro da Chamada por situação atual ou por estarem inativos no sistema. Inclui afastados, desligados, aviso prévio e outras situações; não é uma lista exclusivamente médica.",
      "Parcela fora da Chamada = cadastros fora do quadro operacional / todos os cadastros filtrados. Não é taxa de absenteísmo. Férias continua no quadro operacional quando o cadastro está ativo.",
      "Não há inferência de situação cadastral a partir de ausência de batida. Mudanças de situação e férias planejadas devem ser conferidas nas respectivas telas de cadastro.",
    ],
  },
] as const;
