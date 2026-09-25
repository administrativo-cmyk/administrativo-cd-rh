import type { AccessRequestStatus, UserRole } from "@/lib/auth/types";

const PUBLIC_PATHS = new Set([
  "/login",
  "/cadastro",
  "/cadastro/sucesso",
  "/acesso-pendente",
  "/acesso-bloqueado",
]);

const AUTH_ENTRY_PATHS = new Set(["/login", "/cadastro", "/cadastro/sucesso"]);

export function isAdministrativeRole(role: UserRole | null): boolean {
  return role === "ADMIN" || role === "RH";
}

export function routeRedirectForAccess(
  pathname: string,
  profile: { status: AccessRequestStatus; role: UserRole | null } | null,
): string | null {
  if (!profile) return PUBLIC_PATHS.has(pathname) ? null : "/login";

  if (profile.status === "PENDENTE") {
    return pathname === "/acesso-pendente" ? null : "/acesso-pendente";
  }

  if (profile.status === "BLOQUEADO") {
    return pathname === "/acesso-bloqueado" ? null : "/acesso-bloqueado";
  }

  if (AUTH_ENTRY_PATHS.has(pathname) || pathname === "/acesso-pendente" || pathname === "/acesso-bloqueado") {
    return "/";
  }

  if (pathname.startsWith("/usuarios") && !isAdministrativeRole(profile.role)) {
    return "/";
  }

  return null;
}
