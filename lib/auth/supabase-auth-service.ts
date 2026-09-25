import { AuthFlowError, type AuthService, type SignInInput, type SignInResult, type SignUpInput } from "@/lib/auth/auth-service";
import { normalizeCPF } from "@/lib/auth/cpf";
import { buildTechnicalEmail } from "@/lib/auth/technical-identifier";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/client";

const SAFE_SIGN_UP_ERROR = "Não foi possível concluir o cadastro. Verifique os dados ou procure o RH ou administrador responsável.";

export class SupabaseAuthService implements AuthService {
  async signIn({ cpf, password }: SignInInput): Promise<SignInResult> {
    const supabase = createClient();
    const email = await buildTechnicalEmail(cpf);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      throw new AuthFlowError("INVALID_CREDENTIALS", "CPF ou senha inválidos.");
    }

    const { data: rawProfile, error: profileError } = await supabase
      .from("perfis")
      .select("id,nome_completo,status_usuario,papel_usuario,gestor_id,ultimo_acesso_em,created_at,updated_at")
      .eq("id", data.user.id)
      .single();
    const profile = rawProfile as AuthenticatedProfile | null;

    if (profileError || !profile) {
      await supabase.auth.signOut({ scope: "local" });
      throw new AuthFlowError("PROFILE_UNAVAILABLE", "Não foi possível validar seu perfil de acesso.");
    }

    if (profile.status_usuario === "APROVADO") {
      await supabase.rpc("registrar_ultimo_acesso");
    }

    return { status: profile.status_usuario, role: profile.papel_usuario };
  }

  async signUp({ fullName, cpf, password }: SignUpInput): Promise<{ status: "PENDENTE" }> {
    const supabase = createClient();
    const normalizedCPF = normalizeCPF(cpf);
    const email = await buildTechnicalEmail(normalizedCPF);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          nome_completo: fullName.trim(),
          cpf_normalizado: normalizedCPF,
        },
      },
    });

    if (error || !data.user) {
      throw new AuthFlowError("UNEXPECTED", SAFE_SIGN_UP_ERROR);
    }

    if (data.session) {
      await supabase.auth.signOut({ scope: "local" });
    }

    return { status: "PENDENTE" };
  }

  async signOut(): Promise<void> {
    const { error } = await createClient().auth.signOut();
    if (error) throw new AuthFlowError("UNEXPECTED", "Não foi possível encerrar a sessão.");
  }

  async resetPassword(): Promise<{ available: false }> {
    return { available: false };
  }
}

export const supabaseAuthService = new SupabaseAuthService();
