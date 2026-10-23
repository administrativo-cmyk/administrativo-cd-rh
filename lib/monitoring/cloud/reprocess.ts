import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { workerClient } from "@/lib/monitoring/server";
import { dateSchema } from "@/lib/monitoring/contracts";
import { buildReprocessResults } from "@/lib/monitoring/reprocess";
import type { Json } from "@/lib/monitoring/database";
import { CloudError } from "./server";
import {augmentArchivedInput} from "@/lib/monitoring/archive/server";

const claimSchema = z.object({ pending: z.number().int().nonnegative(), jobs: z.array(z.object({
  employeeId: z.string().uuid(), date: dateSchema, leaseToken: z.string().uuid(), reason: z.string().min(5).max(1000), input: z.unknown(),
})).max(5) });
export async function reprocessCloudDays(signal: AbortSignal, deadline: number) {
  const sourceIds = [...new Set(process.env.MONITORING_INGEST_SOURCE_IDS?.split(",").map(value => value.trim()).filter(Boolean) ?? [])];
  let processed = 0; let failed = 0; let pending = 0;let deferred=0;
  if (!sourceIds.length) return { processed, failed, pending };
  const client = workerClient();
  // Five bounded days share one claim and one idempotent acknowledgment. Reserve
  // time to finish/release every claimed day before claiming another group.
  for (let index = 0; index < 600 && Date.now() < deadline - 30_000 && !signal.aborted; index++) {
    const claim = await client.rpc("monitoring_worker", { p_action: "claim", p_data: { sourceIds, limit: 5 } }).abortSignal(signal);
    if (claim.error) throw new CloudError("CLOUD_REPROCESS_FAILED");
    const data = claimSchema.parse(claim.data); pending = data.pending;
    if (!data.jobs.length) break;
    const results:Array<Json>=[];
    const ready:typeof data.jobs=[];
    for(const job of data.jobs){
    try {
      signal.throwIfAborted();
      const archived=await augmentArchivedInput(job.input,{employeeId:job.employeeId,start:job.date,end:job.date});
      const [day] = buildReprocessResults(archived.input, { employeeId: job.employeeId, start: job.date, end: job.date, reason: job.reason }, Date.now());
      if (!day) throw new CloudError("CLOUD_REPROCESS_FAILED");
      results.push({ ...day, leaseToken: job.leaseToken, reason: job.reason, actor: null } as unknown as Json);ready.push(job);
    } catch(error) {
      if(error instanceof Error&&error.message==='MONITORING_FUTURE_PERIOD'&&'availableAt' in error&&typeof error.availableAt==='number'&&Number.isFinite(error.availableAt)&&error.availableAt>Date.now()){
        const defer=await client.rpc("monitoring_worker",{p_action:"defer",p_data:{employeeId:job.employeeId,date:job.date,leaseToken:job.leaseToken,until:new Date(error.availableAt+60000).toISOString()}}).abortSignal(AbortSignal.timeout(5000));
        if(!defer.error){deferred++;continue;}
      }
      failed++;
      const retry = await client.rpc("monitoring_worker", { p_action: "retry", p_data: { employeeId: job.employeeId, date: job.date, leaseToken: job.leaseToken, code: "CLOUD_REPROCESS_FAILED" } }).abortSignal(AbortSignal.timeout(5000));
      if (retry.error)continue;
    }
    }
    if(!results.length)continue;
    const receipt={id:randomUUID(),jobs:results};
    let finish=await client.rpc("monitoring_worker",{p_action:"finish_many",p_data:receipt}).abortSignal(signal);
    const confirmed=(response:typeof finish)=>!response.error&&response.data!==null&&typeof response.data==="object"&&!Array.isArray(response.data)&&response.data.finished===results.length;
    // Reuse the same receipt after an uncertain response; never double-apply.
    if(!confirmed(finish))finish=await client.rpc("monitoring_worker",{p_action:"finish_many",p_data:receipt}).abortSignal(AbortSignal.timeout(5000));
    if(confirmed(finish)){processed+=results.length;pending=Math.max(0,pending-results.length);continue;}
    failed+=ready.length;
    for(const job of ready)await client.rpc("monitoring_worker",{p_action:"retry",p_data:{employeeId:job.employeeId,date:job.date,leaseToken:job.leaseToken,code:"CLOUD_REPROCESS_FAILED"}}).abortSignal(AbortSignal.timeout(5000));
    if(signal.aborted)break;
  }
  return { processed, failed, pending,deferred };
}
