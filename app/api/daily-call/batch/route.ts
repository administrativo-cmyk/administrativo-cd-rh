import { batchPreviewSchema, batchRequestSchema } from "@/lib/daily-call-operations";
import { dailyCallSession, operationFailure, operationHeaders } from "@/lib/daily-call-operations-server";
import { boundedJson } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
export async function POST(request: Request) {
 if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
 const auth = await dailyCallSession(true); if (auth.response) return auth.response;
 let raw: unknown; try { raw = await boundedJson(request, 65536); } catch { return Response.json({ error: "Lote inválido ou grande demais." }, { status: 400 }); }
 const parsed = batchRequestSchema.safeParse(raw);
 if (!parsed.success) return Response.json({ error: "Selecione até 100 lançamentos e informe a justificativa." }, { status: 400 });
 try {
  const { data, error } = await auth.client.rpc("daily_call_batch", { p_action: parsed.data.action, p_data: parsed.data.data });
  if (error) throw error;
  return Response.json(parsed.data.action === "preview" ? batchPreviewSchema.parse(data) : data, { headers: operationHeaders });
 } catch (error) { return operationFailure(error); }
}
