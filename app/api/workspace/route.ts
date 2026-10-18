import { z } from "zod";
import { boundedJson, monitoringSession } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
import { workspaceSchemas, type WorkspaceAction } from "@/lib/workspace/contracts";
import { workspaceFailure, workspaceQuery } from "@/lib/workspace/server";
const envelopeSchema = z.object({ action: z.string(), data: z.unknown() }).strict();
export async function POST(request: Request) {
 if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
 const session = await monitoringSession(); if (session.response) return session.response;
 let raw: unknown; try { raw = await boundedJson(request, 16384); } catch { return Response.json({ error: "Conteúdo inválido." }, { status: 400 }); }
 const envelope = envelopeSchema.safeParse(raw);
 if (!envelope.success || !Object.hasOwn(workspaceSchemas, envelope.data.action)) return Response.json({ error: "Operação inválida." }, { status: 400 });
 const action = envelope.data.action as WorkspaceAction;
 const data = workspaceSchemas[action].safeParse(envelope.data.data);
 if (!data.success) return Response.json({ error: "Revise os campos e a versão consultada." }, { status: 400 });
 try { return Response.json(await workspaceQuery(action, data.data), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return workspaceFailure(error); }
}
