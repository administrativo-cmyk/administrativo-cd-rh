import { z } from "zod";
import { assertCloudSource, cloudFailure, cloudJobSchema, cloudWorker, dispatchHash, CloudError } from "@/lib/monitoring/cloud/server";
import { downloadCloudObject } from "@/lib/monitoring/cloud/storage";
import { processCloudSnapshot, cloudBatchPlanSchema } from "@/lib/monitoring/cloud/processor";
import { reprocessCloudDays } from "@/lib/monitoring/cloud/reprocess";

export const runtime = "nodejs";
export const maxDuration = 300;
const claimSchema = z.object({ job: cloudJobSchema.nullable(), reprocess: z.boolean().optional() });
const headers = { "Cache-Control": "private, no-store" };
function failureCode(error: unknown): string {
  if (error instanceof CloudError) return error.code;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{1,99}$/.test(error.code)) return error.code;
  return "CLOUD_PROCESSING_FAILED";
}
export async function POST(request: Request) {
  // This token is issued by the database for one invocation only, consumed atomically by claim, and expires in 60s.
  // No permanent worker or database secret is placed in pg_net's readable request queue.
  let tokenHash: string;
  try { tokenHash = dispatchHash(request); } catch (error) { return cloudFailure(error); }
  const deadline = Date.now() + 230_000;
  // Work belongs to the durable queue, not to the HTTP caller's connection. A scheduler disconnect cannot cancel it.
  const signal = AbortSignal.timeout(230_000);
  let claim: z.infer<typeof claimSchema>;
  try { claim = claimSchema.parse(await cloudWorker("claim", { tokenHash }, signal)); }
  catch (error) { return cloudFailure(error); }
  const job = claim.job;
  if (!job && !claim.reprocess) return Response.json({ accepted: true, state: "idle" }, { headers });
  if (job) {
    if (!job.leaseToken) return cloudFailure(new CloudError("CLOUD_UNAVAILABLE"));
    const lease = { id: job.id, leaseToken: job.leaseToken };
    try {
      assertCloudSource(job.sourceId);
      const bytes = await downloadCloudObject(job, signal);
      const result = await processCloudSnapshot({
        id: job.id, source: { ...job.source, declaredCoverage: job.source.declaredCoverage ?? undefined },
        sha256: job.sha256, byteLength: job.byteLength, fileName: job.fileName, parserVersion: job.parserVersion, nextBatch: job.cursor,
        ...(job.plan ? { plan: cloudBatchPlanSchema.parse(job.plan) } : {}),
      }, bytes, {
        signal, deadline, maxBatches: 25,
        persist: async (batch, context) => {
          const persisted = await cloudWorker("persist", { ...lease, expectedCursor: context.expectedCursor, batch, plan: context.plan }, context.signal);
          const response = z.object({ result: z.object({ accepted: z.boolean().optional() }).passthrough() }).parse(persisted).result;
          if (response.accepted === false) throw new CloudError("CLOUD_BATCH_REJECTED");
          return { ...response, accepted: true };
        },
      });
      await cloudWorker(result.status === "complete" ? "finish" : "release", lease, AbortSignal.timeout(8000));
    } catch (error) {
      const code = failureCode(error);
      const retryable = signal.aborted || ["CLOUD_DOWNLOAD_FAILED", "CLOUD_UNAVAILABLE", "CLOUD_PROCESSING_FAILED", "CLOUD_ROUND_ABORTED", "CLOUD_ROUND_DEADLINE_EXCEEDED"].includes(code);
      // Fencing makes this harmless if a later worker already owns the expired lease.
      await cloudWorker("fail", { ...lease, code, retryable }, AbortSignal.timeout(5000)).catch(() => undefined);
      console.error("[monitoring-cloud]", { jobId: job.id, code });
      return Response.json({ accepted: true, state: retryable ? "retry" : "failed", code }, { headers });
    }
  }
  const reprocess = await reprocessCloudDays(signal, deadline).catch(() => ({ pending: true }));
  return Response.json({ accepted: true, state: job ? "processed" : "idle", reprocess }, { headers });
}
