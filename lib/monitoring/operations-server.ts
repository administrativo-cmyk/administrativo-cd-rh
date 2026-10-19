import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "./database";
type Operation = "monitoring_binding_change" | "monitoring_sources_admin" | "operational_import" | "monitoring_defense_group_changes";
type Database = { public: { Tables: Record<never, never>; Views: Record<never, never>; Enums: Record<never, never>; CompositeTypes: Record<never, never>; Functions: { [K in Operation]: { Args: { p_action: string; p_data: Json }; Returns: Json } } } };
export async function monitoringOperation(operation: Operation, action: string, data: unknown) {
  const client = await createClient<Database>();
  const { data: result, error } = await client.rpc(operation, { p_action: action, p_data: data as Json });
  if (error) throw Object.assign(new Error("OPERATION_FAILED"), { code: error.message.match(/\b(?:BINDING|SOURCE|IMPORT|IDENTITY)_[A-Z_]+\b/)?.[0] ?? error.code });
  return result;
}
const messages: Record<string, string> = {
  BINDING_STALE: "O vínculo mudou. Atualize a consulta.", BINDING_SUPERSEDED: "Use a revisão mais recente deste vínculo.", BINDING_INVALID: "Revise o identificador, colaborador, fonte e vigência.",
  BINDING_NOT_FOUND: "Vínculo não encontrado.", IDENTITY_VALIDITY_CONFLICT: "Esta identidade já tem vínculo no período. Revise a vigência.",
  SOURCE_DISABLED: "A fonte está desativada.", SOURCE_STALE: "A fonte mudou. Atualize a consulta.", SOURCE_CONTRACT_IMMUTABLE: "Fonte com histórico mantém tipo, fuso e espaço de identidade. Cadastre outra fonte para mudar esses campos.", SOURCE_INVALID: "Revise os campos da fonte.", SOURCE_NOT_FOUND: "Fonte não encontrada.",
  IMPORT_STALE: "O lote mudou. Atualize a prévia.", IMPORT_EXPIRED: "A prévia expirou. Envie o arquivo novamente.", IMPORT_NOT_FOUND: "Lote não encontrado para esta conta.", IMPORT_INVALID: "Revise os campos, mapeamento e arquivo.",
};
export function operationFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "OPERATION_UNAVAILABLE";
  return Response.json({ error: messages[code] ?? "Não foi possível concluir a operação.", code }, { status: code === "42501" || code.endsWith("FORBIDDEN") ? 403 : messages[code] ? 409 : 503, headers: { "Cache-Control": "private, no-store" } });
}
