import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/persistence/database.types";
import type { PlanningAction } from "./contracts";
type PlanningDatabase = { public: { Tables: Record<never, never>; Views: Record<never, never>; Functions: { schedule_planning: { Args: { p_action: string; p_data: Json }; Returns: Json } }; Enums: Record<never, never>; CompositeTypes: Record<never, never> } };
export async function planningQuery(action: PlanningAction, data: unknown) {
  const client = await createClient<PlanningDatabase>();
  const result = await client.rpc("schedule_planning", { p_action: action, p_data: data as Json });
  if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.data;
}
export function planningFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const code = message.match(/(?:PLANNING|SETTING|ADMINISTRATION)_[A-Z_]+/)?.[0] ?? "PLANNING_UNAVAILABLE";
  const messages: Record<string, string> = { PLANNING_FORBIDDEN: "Seu perfil não permite esta operação.", PLANNING_STALE: "Os dados mudaram. Atualize e revise antes de salvar.", PLANNING_INVALID_INPUT: "Revise os campos e os limites de período.", PLANNING_NOT_FOUND: "Configuração não encontrada.", PLANNING_VALIDITY_CONFLICT: "Há outro calendário no mesmo escopo e período.", SETTING_VALIDITY_CONFLICT: "Uma pessoa selecionada já tem escala nesse período. Nenhuma atribuição do lote foi salva.", PLANNING_POLICY_UNAVAILABLE: "Selecione uma política ativa aplicável à pessoa.", PLANNING_SUGGESTION_UNAVAILABLE: "A sugestão deixou de atender à política. Consulte novamente." };
  const status = code.endsWith("FORBIDDEN") ? 403 : code.endsWith("INVALID_INPUT") ? 400 : code.endsWith("NOT_FOUND") ? 404 : code === "PLANNING_UNAVAILABLE" ? 503 : 409;
  return Response.json({ code, error: messages[code] ?? "Planejamento indisponível. Confira a instalação e tente novamente." }, { status, headers: { "Cache-Control": "private, no-store" } });
}
