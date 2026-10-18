import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/persistence/database.types";
import type { AuditQuery, AuditSnapshot } from "./contracts";
type AuditDatabase = { public: { Tables: Record<never, never>; Views: Record<never, never>; Functions: { audit_history: { Args: { p_data: Json }; Returns: Json } }; Enums: Record<never, never>; CompositeTypes: Record<never, never> } };
export async function loadAuditHistory(query: AuditQuery): Promise<AuditSnapshot> {
 const client = await createClient<AuditDatabase>();
 const { data, error } = await client.rpc("audit_history", { p_data: query });
 if (error) throw Object.assign(new Error("Histórico indisponível."), { code: error.code });
 return data as unknown as AuditSnapshot;
}
