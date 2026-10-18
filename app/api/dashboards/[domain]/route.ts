import { dashboardDomainSchema, parseDashboardFilters } from "@/lib/dashboards/contracts";
import { DashboardError, dashboardSession, loadDashboard } from "@/lib/dashboards/server";
import { dashboardCsv } from "@/lib/dashboards/export";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { reportOperationalError } from "@/lib/security/operational-error";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, context: { params: Promise<{ domain: string }> }) {
  const domain = dashboardDomainSchema.safeParse((await context.params).domain);
  if (!domain.success) return Response.json({ error: "Dashboard não encontrado." }, { status: 404, headers });
  const session = await dashboardSession();
  if (session.response) return session.response;
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const format = raw.format ?? "json";
  delete raw.format;
  if (!["json", "csv"].includes(format)) return Response.json({ error: "Formato inválido." }, { status: 400, headers });
  let filters;
  try { filters = parseDashboardFilters(domain.data, raw, todayInSaoPaulo()); }
  catch { return Response.json({ error: "Revise as datas e os filtros. Chamada: até 31 dias; Monitoramento: até 367 dias." }, { status: 400, headers }); }
  try {
    const snapshot = await loadDashboard(domain.data, filters);
    if (format === "csv") return new Response(dashboardCsv(snapshot), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="dashboard-${domain.data}.csv"`, "X-Content-Type-Options": "nosniff" } });
    return Response.json(snapshot, { headers });
  } catch (error) {
    const code = error instanceof DashboardError ? error.code : error instanceof Error ? error.message : "DASHBOARD_FAILURE";
    const status = error instanceof DashboardError ? error.status : code === "DASHBOARD_SOURCE_CHANGED" ? 409 : 503;
    const message = status === 422 ? "O recorte supera 20.000 resultados. Reduza o período ou filtre unidade/gestor."
      : status === 409 ? "Os dados mudaram durante a consulta. Atualize o dashboard."
        : "Não foi possível carregar este dashboard. Nenhum dado de demonstração foi utilizado.";
    const correlationId = reportOperationalError("dashboard.read", error);
    return Response.json({ error: message, correlationId }, { status, headers });
  }
}
