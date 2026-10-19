import { z } from "zod";
import { boundedJson, monitoringSession } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
import { assertCloudSource, cloudAdmin, cloudFailure, cloudJob, publicCloudJob } from "@/lib/monitoring/cloud/server";

export const runtime = "nodejs";
const parameters = z.object({ id: z.string().uuid(), action: z.enum(["complete", "retry", "cancel"]) });
export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const session = await monitoringSession(true); if (session.response) return session.response;
  try {
    const { id, action } = parameters.parse(await context.params);
    const input = z.object({ expectedUpdatedAt: z.string().datetime({ offset: true }).optional() }).strict().parse(await boundedJson(request, 1024));
    const job = cloudJob(await cloudAdmin("get", { id })); assertCloudSource(job.sourceId);
    if (action !== "complete" && !input.expectedUpdatedAt) return Response.json({ error: "Atualize a lista antes de continuar.", code: "CLOUD_STALE" }, { status: 409 });
    const changed = cloudJob(await cloudAdmin(action, { id, expectedUpdatedAt: input.expectedUpdatedAt ?? job.updatedAt }));
    return Response.json(publicCloudJob(changed), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return cloudFailure(error); }
}
