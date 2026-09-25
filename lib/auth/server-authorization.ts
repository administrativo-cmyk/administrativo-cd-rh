import "server-only";

import { redirect } from "next/navigation";
import type { AuthenticatedProfile, UserRole } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

export async function requireApprovedProfile(allowedRoles?: UserRole[]): Promise<AuthenticatedProfile> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsError || typeof claimsData?.claims?.sub !== "string" ? null : claimsData.claims.sub;

  if (!userId) redirect("/login");

  const { data: rawProfile } = await supabase
    .from("perfis")
    .select("id,nome_completo,status_usuario,papel_usuario,gestor_id,ultimo_acesso_em,created_at,updated_at")
    .eq("id", userId)
    .single();
  const profile = rawProfile as AuthenticatedProfile | null;

  if (!profile) redirect("/login");
  if (profile.status_usuario === "PENDENTE") redirect("/acesso-pendente");
  if (profile.status_usuario === "BLOQUEADO") redirect("/acesso-bloqueado");
  if (allowedRoles && (!profile.papel_usuario || !allowedRoles.includes(profile.papel_usuario))) redirect("/");

  return profile;
}
