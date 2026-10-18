import { z } from "zod";
import { allowedIngestSource, validWorkerToken } from "@/lib/monitoring/ingest-security";
import { boundedJson, monitoringFailure, workerClient } from "@/lib/monitoring/server";
export async function POST(request: Request) {
  if (!validWorkerToken(request.headers.get("authorization"), process.env.MONITORING_INGEST_TOKEN)) return Response.json({ error: "Credencial inválida." }, { status: 401 });
  let input: unknown; try { input = await boundedJson(request, 16384); } catch { return Response.json({ error: "Conteúdo inválido." }, { status: 400 }); }
  const parsed = z.object({ sourceIds: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)).max(100) }).strict().safeParse(input);
  if (!parsed.success) return Response.json({ error: "Informe as fontes autorizadas." }, { status: 400 });
  if (parsed.data.sourceIds.some(id => !allowedIngestSource(id))) return Response.json({ error: "Fonte não autorizada neste servidor." }, { status: 403 });
  try { const { data, error } = await workerClient().rpc("monitoring_worker_sources", { p_ids: [...new Set(parsed.data.sourceIds)] }); if (error) throw error; return Response.json(data, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return monitoringFailure(error); }
}
