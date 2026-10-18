import { administrationEnvelopeSchema, administrationListSchema, archiveInputSchema, saveSchemas } from "@/lib/administration/contracts";
import { administrationFailure, administrationQuery } from "@/lib/administration/server";
import { boundedJson, monitoringSession } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const session = await monitoringSession();
  if (session.response) return session.response;
  let raw: unknown;
  try { raw = await boundedJson(request, 32768); } catch { return Response.json({ error: "Conteúdo inválido." }, { status: 400 }); }
  const envelope = administrationEnvelopeSchema.safeParse(raw);
  if (!envelope.success) return Response.json({ error: "Operação inválida." }, { status: 400 });
  const { entity, action } = envelope.data;
  const schema = action === "list" ? administrationListSchema : action === "save" ? saveSchemas[entity] : archiveInputSchema;
  const data = schema.safeParse(envelope.data.data);
  if (!data.success) return Response.json({ error: "Revise os campos e a versão consultada.", fields: data.error.flatten() }, { status: 400 });
  try { return Response.json(await administrationQuery(entity, action, data.data), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return administrationFailure(error); }
}
