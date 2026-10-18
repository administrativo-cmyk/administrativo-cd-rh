import { sourceSaveSchema } from "@/lib/monitoring/operations-contracts";
import { monitoringOperation, operationFailure } from "@/lib/monitoring/operations-server";
import { boundedJson, monitoringSession } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
export async function GET() {
  const session = await monitoringSession(true); if (session.response) return session.response;
  try { return Response.json(await monitoringOperation("monitoring_sources_admin", "list", {}), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return operationFailure(error); }
}
export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const session = await monitoringSession(true); if (session.response) return session.response;
  let input: unknown; try { input = await boundedJson(request); } catch { return Response.json({ error: "Conteúdo inválido." }, { status: 400 }); }
  const parsed = sourceSaveSchema.safeParse(input); if (!parsed.success) return Response.json({ error: "Revise os campos da fonte." }, { status: 400 });
  try { return Response.json(await monitoringOperation("monitoring_sources_admin", "save", parsed.data), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return operationFailure(error); }
}
