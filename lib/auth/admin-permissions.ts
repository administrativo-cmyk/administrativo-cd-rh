import type { UserRole } from "@/lib/auth/types";

export function assignableRolesFor(actorRole: UserRole | null): UserRole[] {
  if (actorRole === "ADMIN") return ["ADMIN", "RH", "GESTOR", "LEITURA"];
  if (actorRole === "RH") return ["GESTOR", "LEITURA"];
  return [];
}

export function canManageRole(actorRole: UserRole | null, targetRole: UserRole | null): boolean {
  if (actorRole === "ADMIN") return true;
  if (actorRole === "RH") return targetRole === "GESTOR" || targetRole === "LEITURA";
  return false;
}
