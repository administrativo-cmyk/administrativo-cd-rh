import "server-only";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import type { Database, Json } from "./persistence/database.types";
import { reportOperationalError } from "./security/operational-error";
type OperationsDatabase = { public: Omit<Database["public"], "Functions"> & { Functions: Database["public"]["Functions"] & {
 daily_call_batch: { Args: { p_action: string; p_data: Json }; Returns: Json };
 daily_call_attachments: { Args: { p_action: string; p_data: Json }; Returns: Json };
 daily_call_attachment_upload: { Args: { p_actor: string; p_data: Json }; Returns: Json };
} } };
export const operationHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function dailyCallSession(write = false) {
 const client = await createClient<OperationsDatabase>();
 const { data, error } = await client.auth.getClaims();
 const actor = error ? null : data?.claims?.sub;
 if (typeof actor !== "string") return { response: Response.json({ error: "Sessão necessária." }, { status: 401, headers: operationHeaders }) } as const;
 const { data: profile } = await client.from("perfis").select("status_usuario,papel_usuario").eq("id", actor).single();
 if (!profile || profile.status_usuario !== "APROVADO" || !profile.papel_usuario || (write && !["ADMIN", "RH", "GESTOR"].includes(profile.papel_usuario))) return { response: Response.json({ error: "Acesso não autorizado." }, { status: 403, headers: operationHeaders }) } as const;
 return { client, actor } as const;
}
export async function uploadValidatedAttachment(actor: string, data: Json) {
 const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.MONITORING_SUPABASE_SERVICE_ROLE_KEY;
 if (!url || !key) throw new Error("ATTACHMENT_SERVER_UNAVAILABLE");
 return createServiceClient<OperationsDatabase>(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).rpc("daily_call_attachment_upload", { p_actor: actor, p_data: data });
}
export function operationFailure(error: unknown) {
 const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNAVAILABLE";
 const status = code === "42501" ? 403 : ["PT409", "40001"].includes(code) ? 409 : ["22023", "22P02", "23514"].includes(code) ? 400 : 503;
 const errorMessage = status === 403 ? "Acesso não autorizado a este colaborador ou operação." : status === 409 ? "Os dados mudaram ou o arquivo já existe. Atualize a consulta e confira novamente." : status === 400 ? "Confira os dados, o lançamento da data e os limites de anexos." : "Operação indisponível. Confira a instalação e tente novamente.";
 return Response.json({ error: errorMessage, correlationId: reportOperationalError("daily-call.operations", error) }, { status, headers: operationHeaders });
}
