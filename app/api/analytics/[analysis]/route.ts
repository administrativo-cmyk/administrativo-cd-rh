import { analysisKindSchema, parseAnalysisFilters } from "@/lib/analytics/contracts";
import { loadAnalysis } from "@/lib/analytics/server";
import { dashboardSession } from "@/lib/dashboards/server";
import { dashboardCsv } from "@/lib/dashboards/export";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { reportOperationalError } from "@/lib/security/operational-error";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, context: { params: Promise<{ analysis: string }> }) {
  const kind = analysisKindSchema.safeParse((await context.params).analysis);
  if (!kind.success) return Response.json({ error: "Análise não encontrada." }, { status: 404, headers });
  const session = await dashboardSession();
  if (session.response) return session.response;
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const format = raw.format ?? "json"; delete raw.format;
  if (!["json", "csv"].includes(format)) return Response.json({ error: "Formato inválido." }, { status: 400, headers });
  let filters;
  try { filters = parseAnalysisFilters(kind.data, raw, todayInSaoPaulo()); }
  catch { return Response.json({ error: "Revise a data de referência e os filtros." }, { status: 400, headers }); }
  try {
    const snapshot = await loadAnalysis(kind.data, filters);
    if (format === "csv") return new Response(dashboardCsv(snapshot), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="analise-${kind.data}.csv"`, "X-Content-Type-Options": "nosniff" } });
    return Response.json(snapshot, { headers });
  } catch (error) {
    const correlationId = reportOperationalError("analytics.read", error);
    return Response.json({ error: "Não foi possível carregar esta análise. Tente atualizar a consulta.", correlationId }, { status: 503, headers });
  }
}
