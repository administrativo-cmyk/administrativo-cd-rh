import type { AccessRequestStatus, AdministrativeUser, UserRole } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/client";

export type UserFilters = {
  status: AccessRequestStatus | null;
  role: UserRole | null;
  search: string;
};

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

  async approve(userId: string, role: UserRole): Promise<void> {
    const { error } = await createClient().rpc("aprovar_usuario", {
      p_usuario_id: userId,
      p_papel: role,
      p_gestor_id: null,
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
