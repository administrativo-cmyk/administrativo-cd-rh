import type { AccessRequestStatus, UserRole } from "@/lib/auth/types";
import type { UserEditInput, VersionedAdministrativeUser } from "@/lib/administration/users-contracts";
import { createClient } from "@/lib/supabase/client";

export type UserFilters = {
  status: AccessRequestStatus | null;
  role: UserRole | null;
  search: string;
};

export type ManagerOption = { id: string; nome: string };

function requireSuccess(error: { message: string } | null): void {
  if (error) throw new Error("Não foi possível concluir a operação administrativa.");
}

export const userAdminService = {
  async list(filters: UserFilters): Promise<VersionedAdministrativeUser[]> {
    return await administrativeRequest("list", filters) as VersionedAdministrativeUser[];
  },

  async edit(data: UserEditInput): Promise<void> {
    await administrativeRequest("save", data);
  },

  async listManagers(): Promise<ManagerOption[]> {
    const { data, error } = await createClient().rpc("listar_gestores_quadro");
    requireSuccess(error);
    return (data ?? []) as ManagerOption[];
  },

  async approve(userId: string, role: UserRole, managerId: string | null = null): Promise<void> {
    const { error } = await createClient().rpc("aprovar_usuario", {
      p_usuario_id: userId,
      p_papel: role,
      p_gestor_id: role === "GESTOR" ? managerId : null,
    });
    requireSuccess(error);
  },

  async linkManager(userId: string, managerId: string): Promise<void> {
    const { error } = await createClient().rpc("vincular_gestor_usuario", {
      p_usuario_id: userId,
      p_gestor_id: managerId,
    });
    requireSuccess(error);
  },

  async block(userId: string): Promise<void> {
    const { error } = await createClient().rpc("bloquear_usuario", { p_usuario_id: userId });
    requireSuccess(error);
  },

  async reactivate(userId: string): Promise<void> {
    const { error } = await createClient().rpc("reativar_usuario", { p_usuario_id: userId });
    requireSuccess(error);
  },
};

async function administrativeRequest(action: string, data: unknown): Promise<unknown> {
  const response = await fetch("/api/administration/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir a operação administrativa.");
  return result;
}
