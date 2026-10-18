import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/persistence/database.types";
type UserEditDatabase = { public: { Tables: Record<never, never>; Views: Record<never, never>; Functions: { administration_users: { Args: { p_action: string; p_data: Json }; Returns: Json } }; Enums: Record<never, never>; CompositeTypes: Record<never, never> } };
const messages: Record<string, string> = {
  USER_EDIT_FORBIDDEN: "Você não pode editar este usuário ou atribuir esse papel.", USER_EDIT_INVALID: "Revise os campos informados.",
  USER_EDIT_NOT_FOUND: "Usuário não encontrado.", USER_EDIT_PENDING: "Conclua a aprovação antes de editar o acesso.",
  USER_EDIT_STALE: "Este usuário foi alterado. Atualize a lista e revise a edição.", USER_EDIT_MANAGER_REQUIRED: "Selecione um gestor ativo para o papel GESTOR.",
  USER_EDIT_LAST_ADMIN: "O sistema precisa manter pelo menos um ADMIN aprovado.",
};
export async function usersQuery(action: string, data: unknown) {
  const client = await createClient<UserEditDatabase>();
  const result = await client.rpc("administration_users", { p_action: action, p_data: data as Json });
  if (result.error) throw Object.assign(new Error("USER_EDIT_FAILED"), { code: Object.keys(messages).find(code => result.error.message.includes(code)) ?? result.error.code });
  return result.data;
}
export function usersFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "USER_EDIT_UNAVAILABLE";
  return Response.json({ code, error: messages[code] ?? "Gestão de usuários indisponível. Tente novamente." }, { status: code === "42501" || code === "USER_EDIT_FORBIDDEN" ? 403 : code === "USER_EDIT_INVALID" ? 400 : messages[code] ? 409 : 503, headers: { "Cache-Control": "private, no-store" } });
}
