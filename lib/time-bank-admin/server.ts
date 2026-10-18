import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/persistence/database.types";
import { bankAdminSnapshotSchema, type BankAdminFilters } from "./contracts";
type Database = { public: { Tables: Record<never, never>; Views: Record<never, never>; Enums: Record<never, never>; CompositeTypes: Record<never, never>; Functions: { time_bank_admin: { Args: { p_action: string; p_data: Json }; Returns: Json } } } };
const errors: Record<string, string> = {
  BANK_ADMIN_FORBIDDEN: "Apenas ADMIN e RH podem gerenciar medições.", BANK_ADMIN_INVALID: "Revise os campos e a justificativa.", BANK_ADMIN_NOT_FOUND: "Medição não encontrada.",
  BANK_ADMIN_STALE: "A medição mudou. Atualize a lista antes de tentar novamente.", BANK_ADMIN_CANCELLED: "Restaure a medição cancelada antes de editar.",
  BANK_ADMIN_EMPLOYEE_IMMUTABLE: "O colaborador de uma medição existente não pode ser trocado. Cancele e crie outra medição.", BANK_ADMIN_BASELINE_CONFLICT: "Já existe uma medição ativa para esse colaborador com o mesmo início de vigência.",
};
export async function bankAdminQuery(action: "list" | "history" | "save" | "cancel" | "restore", data: unknown) {
  const client = await createClient<Database>();
  const response = await client.rpc("time_bank_admin", { p_action: action, p_data: data as Json });
  if (response.error) {
    const code = Object.keys(errors).find((key) => response.error.message.includes(key)) ?? response.error.code;
    throw Object.assign(new Error(errors[code] ?? "Não foi possível consultar as medições."), { code });
  }
  return response.data;
}
export async function loadBankAdmin(filters: BankAdminFilters) { return bankAdminSnapshotSchema.parse(await bankAdminQuery("list", filters)); }
export function bankAdminFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "BANK_ADMIN_UNAVAILABLE";
  const status = code === "42501" || code === "BANK_ADMIN_FORBIDDEN" ? 403 : code === "BANK_ADMIN_NOT_FOUND" ? 404 : code === "BANK_ADMIN_INVALID" ? 400 : errors[code] ? 409 : 503;
  const message = code === "PGRST202" || code === "42883" ? "A gestão de medições ainda não está instalada neste ambiente. Solicite a atualização à administração." : errors[code] ?? "Não foi possível concluir a operação. Tente novamente.";
  return Response.json({ code, error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}
