import { bindingMutationSchema } from "@/lib/monitoring/operations-contracts";
import { monitoringOperation, operationFailure } from "@/lib/monitoring/operations-server";
import { boundedJson, monitoringSession } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const session = await monitoringSession(true); if (session.response) return session.response;
  let input: unknown; try { input = await boundedJson(request); } catch { return Response.json({ error: "Conteúdo inválido." }, { status: 400 }); }
  const parsed = bindingMutationSchema.safeParse(input); if (!parsed.success) return Response.json({ error: "Revise os campos e a vigência." }, { status: 400 });
  try { return Response.json(await monitoringOperation("monitoring_binding_change", parsed.data.action, parsed.data.data), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return operationFailure(error); }
}
