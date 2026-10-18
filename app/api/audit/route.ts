import { auditQuerySchema } from "@/lib/audit/contracts";
import { loadAuditHistory } from "@/lib/audit/server";
import { boundedJson, monitoringSession } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
 if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
 const session = await monitoringSession(true); if (session.response) return session.response;
 let raw: unknown;
 try { raw = await boundedJson(request, 8192); } catch { return Response.json({ error: "Consulta inválida." }, { status: 400, headers }); }
 const query = auditQuerySchema.safeParse(raw);
 if (!query.success) return Response.json({ error: "Revise os filtros. O período máximo é de 366 dias." }, { status: 400, headers });
 try { return Response.json(await loadAuditHistory(query.data), { headers }); }
 catch (error) { const forbidden = error && typeof error === "object" && "code" in error && error.code === "42501"; return Response.json({ error: forbidden ? "Acesso não autorizado." : "Histórico indisponível. Tente novamente após a instalação da atualização." }, { status: forbidden ? 403 : 503, headers }); }
}
