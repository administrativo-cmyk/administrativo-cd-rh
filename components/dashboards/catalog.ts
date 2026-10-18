export const dashboardCatalog = [
  { key: "monitoramento", title: "Monitoramento", description: "Jornadas apuradas, tempo na operação, acessos e qualidade dos dados.", detail: "Confira os indicadores junto à cobertura e às jornadas que puderam ser apuradas.", operationHref: "/monitoramento", icon: "monitoring" },
  { key: "chamada-diaria", title: "Chamada Diária", description: "Presença, faltas, justificativas e pendências de preenchimento.", detail: "Acompanhe os registros por dia, situação e origem do lançamento.", operationHref: "/chamada-diaria", icon: "attendance" },
  { key: "banco-de-horas", title: "Banco de Horas", description: "Saldos medidos, compensações e colaboradores sem extrato.", detail: "Compare saldos e classificações na data de referência escolhida.", operationHref: "/banco-de-horas", icon: "balance" },
  { key: "quadro-atual", title: "Quadro Atual", description: "Distribuição do quadro por unidade, gestor e situação cadastral.", detail: "Consulte a composição do quadro e as pendências de cadastro no seu escopo.", operationHref: "/quadro-atual", icon: "workforce" },
] as const;

export type DashboardSlug = (typeof dashboardCatalog)[number]["key"];

export function dashboardDefinition(slug: DashboardSlug) {
  return dashboardCatalog.find((dashboard) => dashboard.key === slug)!;
}
