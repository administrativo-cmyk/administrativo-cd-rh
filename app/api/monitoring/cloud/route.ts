import { z } from "zod";
import { boundedJson, monitoringSession, workerClient } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
import { ingestionParserVersion } from "@/lib/monitoring/ingestion/parsers";
import { assertCloudSource, cloudAdmin, cloudBucket, cloudFailure, cloudJob, cloudJobSchema, cloudMaxFileBytes, cloudObjectPath, publicCloudJob, CloudError } from "@/lib/monitoring/cloud/server";
import { allowedIngestSource } from "@/lib/monitoring/ingest-security";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "private, no-store" };
const requestSchema = z.object({
  sourceId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
  fileName: z.string().min(1).max(200).refine(value => !/[\\/\x00-\x1f\x7f]/.test(value) && value.trim() === value),
  byteLength: z.number().int().positive().max(cloudMaxFileBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  afdProfile: z.enum(["legacy", "iso"]).optional(),
}).strict();
const listSchema = z.object({
  jobs: z.array(cloudJobSchema), sources: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(["afd", "defense-access", "defense-person"]) })),
  total: z.number().optional(), offset: z.number().optional(), limit: z.number().optional(),
  automationReady: z.boolean().default(false),
});
export async function GET() {
  const session = await monitoringSession(true); if (session.response) return session.response;
  try {
    const data = listSchema.parse(await cloudAdmin("list", { limit: 100 }));
    return Response.json({ ...data, jobs: data.jobs.filter(job => allowedIngestSource(job.sourceId)).map(publicCloudJob), sources: data.sources.filter(source => allowedIngestSource(source.id)), maxFileBytes: cloudMaxFileBytes }, { headers: noStore });
  } catch (error) { return cloudFailure(error); }
}
export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const session = await monitoringSession(true); if (session.response) return session.response;
  try {
    const input = requestSchema.parse(await boundedJson(request, 8192));
    assertCloudSource(input.sourceId);
    const readiness = listSchema.parse(await cloudAdmin("list", { limit: 1 }));
    if (!readiness.automationReady) throw new CloudError("CLOUD_AUTOMATION_DISABLED");
    const sources = readiness.sources;
    const source = sources.find(item => item.id === input.sourceId); if (!source) throw new CloudError("CLOUD_SOURCE_FORBIDDEN");
    if (source.kind === "afd" ? !/\.txt$/i.test(input.fileName) || !input.afdProfile : !/\.xlsx$/i.test(input.fileName) || input.afdProfile !== undefined) throw new CloudError("CLOUD_INVALID");
    const reservation = await cloudAdmin("create", {
      ...input, parserVersion: ingestionParserVersion({ kind: source.kind, afdProfile: input.afdProfile }),
      ...(source.kind === "afd" ? { encoding: input.afdProfile === "legacy" ? "latin1" : "utf8" } : {}),
    });
    let job = cloudJob(reservation);
    const uploadPresent = reservation && typeof reservation === "object" && "uploadPresent" in reservation && reservation.uploadPresent === true;
    if (job.status === "uploading" && uploadPresent) job = cloudJob(await cloudAdmin("complete", { id: job.id, expectedUpdatedAt: job.updatedAt }));
    if (["queued", "processing", "completed"].includes(job.status)) return Response.json({ ...publicCloudJob(job), alreadyUploaded: true }, { headers: noStore });
    if (job.status !== "uploading") throw new CloudError("CLOUD_STATE");
    const { data, error } = await workerClient().storage.from(cloudBucket).createSignedUploadUrl(cloudObjectPath(job), { upsert: false });
    if (error || !data) throw new CloudError("CLOUD_UNAVAILABLE");
    return Response.json({ ...publicCloudJob(job), upload: { url: data.signedUrl, token: data.token, path: data.path, bucket: cloudBucket } }, { status: 201, headers: noStore });
  } catch (error) { return cloudFailure(error); }
}
