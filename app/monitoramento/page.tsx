import { MonitoringApp } from "@/components/monitoring/monitoring-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { filtersSchema, type MonitoringSnapshot } from "@/lib/monitoring/contracts";
import { loadMonitoring } from "@/lib/monitoring/server";
import { reportOperationalError } from "@/lib/security/operational-error";
import { monitoringErrorMessage } from "@/lib/monitoring/errors";

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [profile, params] = await Promise.all([requireApprovedProfile(), searchParams]);
  const today = todayInSaoPaulo();
  const filters = filtersSchema.parse({ start: `${today.slice(0, 7)}-01`, end: today });
  const initialTab = profile.papel_usuario === "ADMIN" || profile.papel_usuario === "RH" ? ({ configuracao: "settings", importacao: "import", conciliacao: "reconcile" } as const)[params.tab as "configuracao" | "importacao" | "conciliacao"] ?? "query" : "query";
  let snapshot: MonitoringSnapshot | null = null;
  let initialError: string | undefined;
  if (initialTab === "query") {
    try { snapshot = await loadMonitoring(filters); }
    catch (cause) { reportOperationalError("monitoring.initial-read", cause); initialError = monitoringErrorMessage(cause); }
  }
  return <MonitoringApp profile={profile} initialFilters={filters} initialSnapshot={snapshot} initialError={initialError} initialTab={initialTab} />;
}
