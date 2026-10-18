import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/persistence/database.types";
import type { WorkspaceAction } from "./contracts";
type WorkspaceDatabase = { public: { Tables: Record<never, never>; Views: Record<never, never>; Functions: { workspace: { Args: { p_action: string; p_data: Json }; Returns: Json } }; Enums: Record<never, never>; CompositeTypes: Record<never, never> } };
const errors: Record<string, string> = { WORKSPACE_FORBIDDEN: "Acesso não autorizado.", WORKSPACE_INVALID_INPUT: "Revise os campos informados.", WORKSPACE_STALE: "Este registro mudou. Atualize a consulta antes de salvar novamente.", WORKSPACE_NOT_FOUND: "Registro indisponível para este usuário." };
export async function workspaceQuery<T>(action: WorkspaceAction, data: unknown = {}): Promise<T> {
 const client = await createClient<WorkspaceDatabase>();
 const result = await client.rpc("workspace", { p_action: action, p_data: data as Json });
 if (result.error) { const code = Object.keys(errors).find(key => result.error.message.includes(key)) ?? result.error.code; throw Object.assign(new Error(errors[code] ?? "Notificações e preferências indisponíveis. Confira a instalação e tente novamente."), { code }); }
 return result.data as T;
}
export function workspaceFailure(error: unknown) {
 const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "WORKSPACE_UNAVAILABLE";
 const status = code === "WORKSPACE_FORBIDDEN" || code === "42501" ? 403 : code === "WORKSPACE_INVALID_INPUT" || code === "22023" || code === "22P02" ? 400 : code === "WORKSPACE_STALE" ? 409 : code === "WORKSPACE_NOT_FOUND" ? 404 : 503;
 return Response.json({ code, error: errors[code] ?? "Notificações e preferências indisponíveis. Confira a instalação e tente novamente." }, { status, headers: { "Cache-Control": "private, no-store" } });
}
