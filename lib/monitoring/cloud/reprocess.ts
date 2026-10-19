import "server-only";
import { z } from "zod";
import { workerClient } from "@/lib/monitoring/server";
import { dateSchema } from "@/lib/monitoring/contracts";
import { buildReprocessResults } from "@/lib/monitoring/reprocess";
import type { Json } from "@/lib/monitoring/database";
import { CloudError } from "./server";

const claimSchema = z.object({ pending: z.number().int().nonnegative(), jobs: z.array(z.object({
  employeeId: z.string().uuid(), date: dateSchema, leaseToken: z.string().uuid(), reason: z.string().min(5).max(1000), input: z.unknown(),
})).max(1) });
export async function reprocessCloudDays(signal: AbortSignal, deadline: number) {
  const sourceIds = [...new Set(process.env.MONITORING_INGEST_SOURCE_IDS?.split(",").map(value => value.trim()).filter(Boolean) ?? [])];
  let processed = 0; let failed = 0; let pending = 0;
  if (!sourceIds.length) return { processed, failed, pending };
  const client = workerClient();
  // Drain while budget remains; a small fixed cap can strand a monthly import for hours.
  // Claim one day at a time: a bounded invocation never leaves an unused group leased for five minutes.
  for (let index = 0; index < 600 && Date.now() < deadline - 15_000 && !signal.aborted; index++) {
    const claim = await client.rpc("monitoring_worker", { p_action: "claim", p_data: { sourceIds, limit: 1 } }).abortSignal(signal);
    if (claim.error) throw new CloudError("CLOUD_REPROCESS_FAILED");
    const data = claimSchema.parse(claim.data); pending = data.pending;
    const job = data.jobs[0]; if (!job) break;
    try {
      signal.throwIfAborted();
      const [day] = buildReprocessResults(job.input, { employeeId: job.employeeId, start: job.date, end: job.date, reason: job.reason }, Date.now());
      if (!day) throw new CloudError("CLOUD_REPROCESS_FAILED");
      const finish = await client.rpc("monitoring_worker", { p_action: "finish", p_data: { ...day, leaseToken: job.leaseToken, reason: job.reason, actor: null } as unknown as Json }).abortSignal(signal);
      if (finish.error) throw finish.error;
      processed++; pending = Math.max(0, pending - 1);
    } catch {
      failed++;
      const retry = await client.rpc("monitoring_worker", { p_action: "retry", p_data: { employeeId: job.employeeId, date: job.date, leaseToken: job.leaseToken, code: "CLOUD_REPROCESS_FAILED" } }).abortSignal(AbortSignal.timeout(5000));
      if (retry.error || signal.aborted) break;
    }
  }
  return { processed, failed, pending };
}
