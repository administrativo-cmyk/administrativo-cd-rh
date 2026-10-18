import { z } from "zod";
import { dateSchema } from "@/lib/monitoring/contracts";
import { allowedIngestSource, validWorkerToken } from "@/lib/monitoring/ingest-security";
import { buildReprocessResults } from "@/lib/monitoring/reprocess";
import { boundedJson, monitoringFailure, workerClient } from "@/lib/monitoring/server";
import type { Json } from "@/lib/monitoring/database";

const requestSchema = z.object({ sourceIds: z.array(z.string().min(1).max(100)).min(1).max(100), limit: z.number().int().min(1).max(10).default(10) });
const claimSchema = z.object({
  pending: z.number().int().nonnegative(),
  jobs: z.array(z.object({ employeeId: z.string().uuid(), date: dateSchema, leaseToken: z.string().uuid(), reason: z.string().min(5).max(1000), input: z.unknown() })).max(10),
});
function failureCode(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    for (const known of ["MONITORING_STALE_INPUT", "MONITORING_LEASE_LOST", "MONITORING_CONFIGURATION_CONFLICT", "MONITORING_SCHEDULE_OVERLAP", "MONITORING_FUTURE_PERIOD"]) if (error.message.includes(known)) return known;
  }
  return "MONITORING_REPROCESS_FAILED";
}

export async function POST(request: Request) {
  if (!validWorkerToken(request.headers.get("authorization"), process.env.MONITORING_INGEST_TOKEN)) return Response.json({ error: "Credencial de ingestão inválida." }, { status: 401 });
  let raw: unknown;
  try { raw = await boundedJson(request, 16_384); }
  catch { return Response.json({ error: "Solicitação inválida." }, { status: 400 }); }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Informe fontes autorizadas e limite entre 1 e 10." }, { status: 400 });
  const sourceIds = [...new Set(parsed.data.sourceIds)];
  if (sourceIds.some((id) => !allowedIngestSource(id))) return Response.json({ error: "Fonte não autorizada para este worker." }, { status: 403 });
  try {
    const client = workerClient();
    const claim = await client.rpc("monitoring_worker", { p_action: "claim", p_data: { sourceIds, limit: parsed.data.limit } });
    if (claim.error) throw claim.error;
    const { jobs, pending } = claimSchema.parse(claim.data);
    let processed = 0;
    let failed = 0;
    const referenceAt = Date.now();
    for (const job of jobs) {
      try {
        const [day] = buildReprocessResults(job.input, { employeeId: job.employeeId, start: job.date, end: job.date, reason: job.reason }, referenceAt);
        if (!day) throw new Error("MONITORING_EMPTY_CALCULATION");
        const finish = await client.rpc("monitoring_worker", { p_action: "finish", p_data: { ...day, leaseToken: job.leaseToken, reason: job.reason, actor: null } as unknown as Json });
        if (finish.error) throw finish.error;
        processed += 1;
      } catch (error) {
        failed += 1;
        const retry = await client.rpc("monitoring_worker", { p_action: "retry", p_data: { employeeId: job.employeeId, date: job.date, leaseToken: job.leaseToken, code: failureCode(error) } });
        if (retry.error) throw retry.error;
      }
    }
    return Response.json({ processed, pending: Math.max(0, pending - processed), failed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return monitoringFailure(error); }
}
