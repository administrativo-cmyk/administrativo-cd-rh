import { z } from "zod";
import { userEditSchema, userListSchema } from "@/lib/administration/users-contracts";
import { usersQuery, usersFailure } from "@/lib/administration/users-server";
import { boundedJson, monitoringSession } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const session = await monitoringSession(true); if (session.response) return session.response;
  let raw: unknown; try { raw = await boundedJson(request, 8192); } catch { return Response.json({ error: "Conteúdo inválido." }, { status: 400 }); }
  const envelope = z.object({ action: z.enum(["list", "save"]), data: z.unknown() }).strict().safeParse(raw);
  if (!envelope.success) return Response.json({ error: "Ação inválida." }, { status: 400 });
  const data = (envelope.data.action === "save" ? userEditSchema : userListSchema).safeParse(envelope.data.data);
  if (!data.success) return Response.json({ error: "Revise os campos, vínculo e versão." }, { status: 400 });
  try { return Response.json(await usersQuery(envelope.data.action, data.data), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return usersFailure(error); }
}
