import { AppShell } from "@/components/app-shell";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { defaultDashboardFilters, parseDashboardFilters, type DashboardDomain, type DashboardSnapshot } from "@/lib/dashboards/contracts";
import { loadDashboard } from "@/lib/dashboards/server";
import { dashboardDefinition } from "./catalog";
import { DashboardApp } from "./dashboard-app";

export type DashboardPageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export async function DashboardPage({ domain, searchParams }: DashboardPageProps & { domain: DashboardDomain }) {
  const profile = await requireApprovedProfile();
  const today = todayInSaoPaulo();
  const query = await searchParams ?? {};
  const input = Object.fromEntries(["start", "end", "unit", "managerId", "query"].filter((key) => query[key] !== undefined).map((key) => [key, query[key]]));
  let filters = defaultDashboardFilters(domain, today);
  let snapshot: DashboardSnapshot | null = null;
  let error = "";
  try { filters = parseDashboardFilters(domain, input, today); }
  catch { error = "Os filtros do endereço são inválidos. Revise as datas e aplique uma nova consulta."; }
  if (!error) {
    try { snapshot = await loadDashboard(domain, filters); }
    catch { error = "Não foi possível carregar o dashboard. Tente atualizar a consulta."; }
  }
  return <AppShell profile={profile} title={`Dashboard · ${dashboardDefinition(domain).title}`} activeLabel="Dashboards">
    <DashboardApp key={domain} domain={domain} today={today} initialFilters={filters} initialSnapshot={snapshot} initialError={error} />
  </AppShell>;
}
