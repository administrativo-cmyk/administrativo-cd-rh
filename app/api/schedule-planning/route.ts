import { z } from "zod";
import { planningEnvelopeSchema, planningSchemas, planningSnapshotSchema, planningRecordSchema, suggestionResultSchema } from "@/lib/schedule-planning/contracts";
import { planningQuery, planningFailure } from "@/lib/schedule-planning/server";
import { boundedJson, monitoringSession } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const session = await monitoringSession(); if (session.response) return session.response;
  let raw: unknown; try { raw = await boundedJson(request, 65536); } catch { return Response.json({ error: "Conteúdo inválido." }, { status: 400 }); }
  const envelope = planningEnvelopeSchema.safeParse(raw);
  if (!envelope.success) return Response.json({ error: "Operação inválida." }, { status: 400 });
  const { action } = envelope.data; const parsed = planningSchemas[action].safeParse(envelope.data.data);
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map(issue => issue.message).join(" · ") }, { status: 400 });
  try {
    const result = await planningQuery(action, parsed.data);
    const schema = action === "list" ? planningSnapshotSchema : action === "suggest" ? suggestionResultSchema : action === "assign" ? z.object({ assigned: z.number().int().positive(), settingIds: z.array(z.string().uuid()) }) : action === "accept_suggestion" ? z.object({ record: z.object({ id: z.string().uuid(), status: z.literal("draft") }) }) : z.object({ changed: z.literal(true), record: planningRecordSchema });
    return Response.json(schema.parse(result), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return planningFailure(error); }
}
