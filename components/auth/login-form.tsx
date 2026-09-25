"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { CpfField } from "@/components/auth/cpf-field";
import { PasswordField } from "@/components/auth/password-field";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { validateLogin, type LoginErrors } from "@/lib/auth/auth-validation";
import { AuthFlowError, type AuthService } from "@/lib/auth/auth-service";
import { supabaseAuthService } from "@/lib/auth/supabase-auth-service";

type LoginFormProps = {
  service?: AuthService;
};

export function LoginForm({ service = supabaseAuthService }: LoginFormProps) {
  const router = useRouter();
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginErrors>({});
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateLogin(cpf, password);

    setErrors(nextErrors);
    setFeedback("");
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      const result = await service.signIn({ cpf, password });
      if (result.status === "PENDENTE") router.push("/acesso-pendente");
      else if (result.status === "BLOQUEADO") router.push("/acesso-bloqueado");
      else router.push("/");
    } catch (error) {
      setFeedback(error instanceof AuthFlowError ? error.message : "Não foi possível entrar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="auth-form-heading">
        <h1>Bem-vindo(a) de volta!</h1>
        <p>Acesse sua conta e continue construindo um ambiente de trabalho mais humano e produtivo.</p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit} autoComplete="off" noValidate>
        <CpfField id="login-cpf" label="Usuário" value={cpf} onChange={setCpf} error={errors.cpf} autoComplete="off" preventAutofill />
        <PasswordField id="login-password" label="Senha" placeholder="Digite sua senha" value={password} onChange={setPassword} error={errors.password} autoComplete="new-password" preventAutofill />

        <button className="auth-text-action" type="button" onClick={() => setForgotOpen(true)}>Esqueceu sua senha?</button>

        <button className="auth-primary-button" type="submit" disabled={loading}>
          {loading ? <><LoaderCircle className="auth-spinner" aria-hidden="true" /> Entrando...</> : <>Entrar <ArrowRight aria-hidden="true" /></>}
        </button>

        {feedback ? <p className="auth-feedback auth-feedback--error" role="status"><CheckCircle2 aria-hidden="true" /> {feedback}</p> : null}

        <div className="auth-divider"><span>ou</span></div>

        <button className="auth-google-button" type="button" onClick={() => setFeedback("Login com Google será disponibilizado futuramente.")}>
          <svg className="auth-google-mark" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.61 20H42V20H24v8h11.3C33.65 32.66 29.22 36 24 36c-6.63 0-12-5.37-12-12s5.37-12 12-12c3.06 0 5.84 1.15 7.96 3.04l5.66-5.66C34.05 6.05 29.27 4 24 4 12.95 4 4 12.95 4 24s8.95 20 20 20 20-8.95 20-20c0-1.34-.14-2.65-.39-4Z" />
            <path fill="#FF3D00" d="m6.31 14.69 6.57 4.82C14.66 15.11 18.96 12 24 12c3.06 0 5.84 1.15 7.96 3.04l5.66-5.66C34.05 6.05 29.27 4 24 4c-7.68 0-14.34 4.34-17.69 10.69Z" />
            <path fill="#4CAF50" d="M24 44c5.17 0 9.86-1.98 13.41-5.19l-6.19-5.24A11.91 11.91 0 0 1 24 36c-5.2 0-9.62-3.32-11.28-7.95l-6.52 5.02A20 20 0 0 0 24 44Z" />
            <path fill="#1976D2" d="M43.61 20H42V20H24v8h11.3a12.04 12.04 0 0 1-4.09 5.57l6.2 5.24C37 39.18 44 34 44 24c0-1.34-.14-2.65-.39-4Z" />
          </svg>
          Entrar com Google
        </button>

        <p className="auth-switch">Ainda não tem uma conta? <Link href="/cadastro">Cadastre-se</Link></p>
      </form>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="auth-dialog">
          <DialogHeader>
            <span className="auth-dialog__icon"><ShieldCheck aria-hidden="true" /></span>
            <DialogTitle>Recuperação de senha</DialogTitle>
            <DialogDescription>Para redefinir sua senha, procure o RH ou administrador responsável.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
