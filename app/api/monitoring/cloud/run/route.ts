import { parseSnapshot } from "@/lib/monitoring/ingestion/parsers";
import { detectAfdEncoding, detectCloudImport } from "@/lib/monitoring/cloud/detection";
import { createHash } from "node:crypto";
import { z } from "zod";
import { assertCloudSource, cloudFailure, cloudJobSchema, cloudWorker, dispatchHash, CloudError } from "@/lib/monitoring/cloud/server";
import { downloadCloudObject } from "@/lib/monitoring/cloud/storage";
import { processCloudSnapshot, cloudBatchPlanSchema } from "@/lib/monitoring/cloud/processor";
import { reprocessCloudDays } from "@/lib/monitoring/cloud/reprocess";
import {ensureArchivedSnapshot} from "@/lib/monitoring/archive/prepare-cloud";
import {serverArchiveStore} from "@/lib/monitoring/archive/server";
import {retainRecentMonths} from "@/lib/monitoring/archive/retention";

export const runtime = "nodejs";
export const maxDuration = 300;
const claimSchema = z.object({ job: cloudJobSchema.nullable(), reprocess: z.boolean().optional() });
const headers = { "Cache-Control": "private, no-store" };
function failureCode(error: unknown): string {
  if (error instanceof CloudError) return error.code;
  if(error instanceof Error&&/^ARCHIVE_[A-Z_]+$/.test(error.message))return error.message;
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
  let job = claim.job;
  if (!job && !claim.reprocess) return Response.json({ accepted: true, state: "idle" }, { headers });
  if (job) {
    if (!job.leaseToken) return cloudFailure(new CloudError("CLOUD_UNAVAILABLE"));
    const lease = { id: job.id, leaseToken: job.leaseToken };
    try {
      assertCloudSource(job.sourceId);
      const bytes = await downloadCloudObject(job, signal);
      if (job.autoDetect) {
        if (createHash("sha256").update(bytes).digest("hex") !== job.sha256) throw new CloudError("CLOUD_SNAPSHOT_HASH_MISMATCH");
        const detected = await detectCloudImport(bytes);
        const encoding = detected.kind === "afd" ? detectAfdEncoding(bytes) : undefined;
        const identifiers: Array<{type:string;value:string;observedOn:string}> = [];
        if (detected.kind === "afd" && detected.afdAllowAlternate) {
          const parsed = await parseSnapshot(bytes, { root: "", id: job.sourceId, timeZone: job.source.timeZone, encoding, ...detected });
          const unique = new Map<string, {type:string;value:string;observedOn:string}>();
          const dateFormat = new Intl.DateTimeFormat("en-CA", {timeZone:job.source.timeZone,year:"numeric",month:"2-digit",day:"2-digit"});
          for (const row of parsed.occurrences) if (row.event?.identity) {
            const {type,value} = row.event.identity; const parts = Object.fromEntries(dateFormat.formatToParts(new Date(row.event.timestamp)).map(part => [part.type,part.value])); const observedOn = `${parts.year}-${parts.month}-${parts.day}`; const key = `${type}:${value}`;
            if (!unique.has(key) && unique.size >= 5000) throw new CloudError("CLOUD_IDENTITY_AMBIGUOUS");
            if (!unique.has(key) || unique.get(key)!.observedOn > observedOn) unique.set(key, {type,value,observedOn});
          }
          identifiers.push(...unique.values());
        }
        job = z.object({ job: cloudJobSchema }).parse(await cloudWorker("route", { ...lease, ...detected, ...(encoding ? { encoding } : {}), ...(identifiers.length ? {identifiers} : {}) }, signal)).job;
        assertCloudSource(job.sourceId);
      }
      await ensureArchivedSnapshot(serverArchiveStore(),{source:{...job.source,declaredCoverage:job.source.declaredCoverage??undefined},sha256:job.sha256,byteLength:job.byteLength,parserVersion:job.parserVersion},bytes);
      const result = await processCloudSnapshot({
        id: job.id, source: { ...job.source, declaredCoverage: job.source.declaredCoverage ?? undefined },
        sha256: job.sha256, byteLength: job.byteLength, fileName: job.fileName, parserVersion: job.parserVersion, nextBatch: job.cursor,
        ...(job.plan ? { plan: cloudBatchPlanSchema.parse(job.plan) } : {}),
      }, bytes, {
        signal, deadline, maxBatches: 100,
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
      const retryable = signal.aborted || ["ARCHIVE_MAINTENANCE","ARCHIVE_NETWORK_ERROR","ARCHIVE_DOWNLOAD_FAILED","ARCHIVE_UPLOAD_FAILED","ARCHIVE_RPC_FAILED","CLOUD_DOWNLOAD_FAILED", "CLOUD_UNAVAILABLE", "CLOUD_PROCESSING_FAILED", "CLOUD_ROUND_ABORTED", "CLOUD_ROUND_DEADLINE_EXCEEDED"].includes(code);
      // Fencing makes this harmless if a later worker already owns the expired lease.
      await cloudWorker("fail", { ...lease, code, retryable }, AbortSignal.timeout(5000)).catch(() => undefined);
      console.error("[monitoring-cloud]", { jobId: job.id, code });
      return Response.json({ accepted: true, state: retryable ? "retry" : "failed", code }, { headers });
    }
  }
  let retention:{pending:boolean;archived?:number};
  try{retention=await retainRecentMonths(serverArchiveStore(),Math.min(deadline,Date.now()+40000));}
  catch(error){console.error("[monitoring-retention]",{code:failureCode(error)});retention={pending:true};}
  const reprocess = await reprocessCloudDays(signal, deadline).catch(() => ({ pending: true }));
  return Response.json({ accepted: true, state: job ? "processed" : "idle", reprocess,retention }, { headers });
}
