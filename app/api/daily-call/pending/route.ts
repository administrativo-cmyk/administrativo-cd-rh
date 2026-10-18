import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/persistence/database.types";
import { workflowCloseResultSchema, workflowMutationSchema, workflowQuerySchema, workflowResolveResultSchema, workflowSnapshotSchema } from "@/lib/daily-call-workflow";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
import { reportOperationalError } from "@/lib/security/operational-error";
import { boundedJson } from "@/lib/monitoring/server";

type WorkflowDatabase = { public: Omit<Database["public"], "Functions"> & { Functions: Database["public"]["Functions"] & {
  daily_call_workflow: { Args: { p_action: string; p_data: Json }; Returns: Json };
} } };
const headers = { "Cache-Control": "private, no-store" };
async function session(write = false) {
  const client = await createClient<WorkflowDatabase>();
  const { data, error } = await client.auth.getClaims();
  const userId = error ? null : data?.claims?.sub;
  if (typeof userId !== "string") return { response: Response.json({ error: "Sessão necessária." }, { status: 401, headers }) } as const;
  const { data: profile } = await client.from("perfis").select("status_usuario,papel_usuario").eq("id", userId).single();
  if (!profile || profile.status_usuario !== "APROVADO" || !profile.papel_usuario || !(write ? ["ADMIN", "RH", "GESTOR"] : ["ADMIN", "RH", "GESTOR", "LEITURA"]).includes(profile.papel_usuario)) {
    return { response: Response.json({ error: "Acesso não autorizado." }, { status: 403, headers }) } as const;
  }
  return { client } as const;
}
function failure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "WORKFLOW_FAILURE";
  const conflict = code === "PT409" || code === "40001";
  const installationPending = code === "PGRST202" || code === "42883";
  const status = conflict ? 409 : code === "42501" ? 403 : ["22023", "22P02"].includes(code) ? 400 : 503;
  const correlationId = reportOperationalError("daily-call.workflow", error);
  return Response.json({ error: installationPending ? "A revisão da chamada ainda não está habilitada no banco deste ambiente. Solicite à administração a conclusão da instalação." : conflict ? "O dia ou o lançamento mudou. Atualize a revisão antes de confirmar." : status === 403 ? "Acesso não autorizado." : status === 400 ? "Revise os dados e resolva todas as pendências antes de finalizar." : "Não foi possível consultar ou salvar a revisão da chamada.", correlationId }, { status, headers });
}
export async function GET(request: Request) {
  const input = workflowQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return Response.json({ error: "Informe período válido de até 31 dias." }, { status: 400, headers });
  const auth = await session(); if (auth.response) return auth.response;
  try {
    const { data, error } = await auth.client.rpc("daily_call_workflow", { p_action: "queue", p_data: { ...input.data, ...(input.data.managerId === "none" ? { managerId: null } : {}) } });
    if (error) return failure(error);
    return Response.json(workflowSnapshotSchema.parse(data), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  const auth = await session(true); if (auth.response) return auth.response;
  let raw: unknown;
  try { raw = await boundedJson(request, 8192); } catch { return Response.json({ error: "Dados inválidos." }, { status: 400, headers }); }
  const input = workflowMutationSchema.safeParse(raw);
  if (!input.success) return Response.json({ error: "Confira a revisão e informe uma justificativa com pelo menos cinco caracteres." }, { status: 400, headers });
  try {
    const { data, error } = await auth.client.rpc("daily_call_workflow", { p_action: input.data.action, p_data: input.data.data });
    if (error) return failure(error);
    return Response.json(input.data.action === "close" ? workflowCloseResultSchema.parse(data) : workflowResolveResultSchema.parse(data), { headers });
  } catch (error) { return failure(error); }
}
