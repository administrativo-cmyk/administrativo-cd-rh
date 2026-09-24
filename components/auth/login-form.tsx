"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { CpfField } from "@/components/auth/cpf-field";
import { PasswordField } from "@/components/auth/password-field";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { validateLogin, type LoginErrors } from "@/lib/auth/auth-validation";
import { mockAuthService, type AuthService } from "@/lib/auth/auth-service";

type LoginFormProps = {
  service?: AuthService;
};

export function LoginForm({ service = mockAuthService }: LoginFormProps) {
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
      await service.signIn({ cpf, password });
      setFeedback("Demonstração concluída. A autenticação real será habilitada na próxima etapa.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="auth-form-heading">
        <span className="auth-form-heading__kicker">Acesso ao sistema</span>
        <h1>Bem-vindo(a) de volta!</h1>
        <p>Acesse sua conta para continuar no Administrativo CD.</p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <CpfField id="login-cpf" label="Usuário" value={cpf} onChange={setCpf} error={errors.cpf} autoFocus />
        <PasswordField id="login-password" label="Senha" placeholder="Digite sua senha" value={password} onChange={setPassword} error={errors.password} autoComplete="current-password" />

        <button className="auth-text-action" type="button" onClick={() => setForgotOpen(true)}>Esqueceu sua senha?</button>

        <button className="auth-primary-button" type="submit" disabled={loading}>
          {loading ? <><LoaderCircle className="auth-spinner" aria-hidden="true" /> Entrando...</> : <>Entrar <ArrowRight aria-hidden="true" /></>}
        </button>

        {feedback ? <p className="auth-feedback auth-feedback--success" role="status"><CheckCircle2 aria-hidden="true" /> {feedback}</p> : null}

        <div className="auth-divider"><span>ou</span></div>

        <button className="auth-google-button" type="button" onClick={() => setFeedback("Integração Google será habilitada em breve.")}>
          <span className="auth-google-mark" aria-hidden="true">G</span>
          Entrar com Google
        </button>

        <p className="auth-switch">Ainda não tem uma conta? <Link href="/cadastro">Cadastre-se</Link></p>
      </form>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="auth-dialog">
          <DialogHeader>
            <span className="auth-dialog__icon"><ShieldCheck aria-hidden="true" /></span>
            <DialogTitle>Recuperação de senha</DialogTitle>
            <DialogDescription>Recuperação de senha será habilitada em breve.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
