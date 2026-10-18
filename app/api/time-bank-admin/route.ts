import { bankAdminEnvelopeSchema, bankAdminListSchema, bankAdminMutationResultSchema, bankAdminSnapshotSchema, bankHistoryInputSchema, bankHistorySchema } from "@/lib/time-bank-admin/contracts";
import { bankAdminFailure, bankAdminQuery } from "@/lib/time-bank-admin/server";
import { dashboardSession } from "@/lib/dashboards/server";
import { boundedJson } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";

const headers = { "Cache-Control": "private, no-store" };
async function session() {
  const auth = await dashboardSession();
  if (auth.response) return auth.response;
  if (!["ADMIN", "RH"].includes(auth.role)) return Response.json({ error: "Apenas ADMIN e RH podem gerenciar medições." }, { status: 403, headers });
}
export async function GET(request: Request) {
  const denied = await session(); if (denied) return denied;
  const raw = Object.fromEntries(new URL(request.url).searchParams); const action = raw.action ?? "list"; delete raw.action;
  if (!["list", "history"].includes(action)) return Response.json({ error: "Consulta inválida." }, { status: 400, headers });
  const parsed = (action === "history" ? bankHistoryInputSchema : bankAdminListSchema).safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Filtros inválidos." }, { status: 400, headers });
  try {
    const result = await bankAdminQuery(action as "list" | "history", parsed.data);
    return Response.json((action === "history" ? bankHistorySchema : bankAdminSnapshotSchema).parse(result), { headers });
  } catch (error) { return bankAdminFailure(error); }
}
export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  const denied = await session(); if (denied) return denied;
  let raw: unknown;
  try { raw = await boundedJson(request, 16384); } catch { return Response.json({ error: "Conteúdo inválido." }, { status: 400, headers }); }
  const parsed = bankAdminEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Revise os campos e a versão consultada.", fields: parsed.error.flatten() }, { status: 400, headers });
  try { return Response.json(bankAdminMutationResultSchema.parse(await bankAdminQuery(parsed.data.action, parsed.data.data)), { headers }); }
  catch (error) { return bankAdminFailure(error); }
}
