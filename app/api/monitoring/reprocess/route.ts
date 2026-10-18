import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
import { boundedJson, monitoringFailure, monitoringQuery, monitoringSession, workerClient } from "@/lib/monitoring/server";
import { reprocessMonitoringSnapshot, reprocessRequestSchema } from "@/lib/monitoring/reprocess";
import type { Json } from "@/lib/monitoring/database";

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const session = await monitoringSession(true);
  if (session.response) return session.response;
  let raw: unknown;
  try { raw = await boundedJson(request, 8192); }
  catch { return Response.json({ error: "Conteúdo inválido." }, { status: 400 }); }
  const parsed = reprocessRequestSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Informe colaborador, período de até 31 dias e motivo.", fields: parsed.error.flatten() }, { status: 400 });
  let saved = 0;
  try {
    const snapshot = await monitoringQuery("input", { employeeId: parsed.data.employeeId, start: parsed.data.start, end: parsed.data.end });
    const days = reprocessMonitoringSnapshot(snapshot, parsed.data, Date.now());
    const client = workerClient();
    for (const day of days) {
      const { error } = await client.rpc("monitoring_save_result", { p_data: { ...day, reason: parsed.data.reason, actor: session.userId } as unknown as Json });
      if (error) {
        if (error.message?.includes("MONITORING_STALE_INPUT")) return Response.json({ error: "Dados mudaram durante o cálculo. Execute novamente para atualizar o período.", saved }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
        throw Object.assign(new Error("MONITORING_SAVE_FAILED"), { code: error.code });
      }
      saved += 1;
    }
    return Response.json({ ok: true, saved, version: days[0]?.version ?? null, ruleVersion: days[0]?.ruleVersion ?? null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && ["MONITORING_CONFIGURATION_CONFLICT", "MONITORING_SCHEDULE_OVERLAP", "MONITORING_FUTURE_PERIOD"].includes(error.message)) {
      return Response.json({ error: "Configuração ambígua ou período futuro. Revise escalas, vigências e evidências antes de reprocessar.", code: error.message, saved }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
    }
    return monitoringFailure(error);
  }
}
