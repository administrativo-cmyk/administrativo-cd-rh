import type { AccessRequestStatus, AdministrativeUser, UserRole } from "@/lib/auth/types";
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
  async list(filters: UserFilters): Promise<AdministrativeUser[]> {
    const { data, error } = await createClient().rpc("listar_usuarios", {
      p_status: filters.status,
      p_papel: filters.role,
      p_busca: filters.search.trim() || null,
    });
    requireSuccess(error);
    return (data ?? []) as AdministrativeUser[];
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
