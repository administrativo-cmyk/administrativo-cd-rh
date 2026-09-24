"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, UserRound } from "lucide-react";
import { CpfField } from "@/components/auth/cpf-field";
import { PasswordField } from "@/components/auth/password-field";
import { validateRegistration, type RegistrationErrors } from "@/lib/auth/auth-validation";
import { mockAuthService, type AuthService } from "@/lib/auth/auth-service";

type RegisterFormProps = {
  service?: AuthService;
};

export function RegisterForm({ service = mockAuthService }: RegisterFormProps) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateRegistration({ fullName, cpf, password, confirmation });

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      const result = await service.signUp({ fullName: fullName.trim(), cpf, password });
      if (result.status === "PENDENTE") router.push("/cadastro/sucesso");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="auth-form-heading auth-form-heading--register">
        <span className="auth-form-heading__kicker">Solicitação de acesso</span>
        <h1>Crie sua conta</h1>
        <p>Cadastre seus dados para solicitar acesso ao Administrativo CD.</p>
      </div>

      <form className="auth-form auth-form--register" onSubmit={handleSubmit} noValidate>
        <div className="auth-field">
          <label htmlFor="register-name">Nome completo</label>
          <div className={`auth-input-wrap${errors.fullName ? " auth-input-wrap--error" : ""}`}>
            <UserRound aria-hidden="true" />
            <input id="register-name" name="name" type="text" autoComplete="name" placeholder="Digite seu nome completo" value={fullName} onChange={(event) => setFullName(event.target.value)} aria-invalid={Boolean(errors.fullName)} aria-describedby={errors.fullName ? "register-name-error" : undefined} autoFocus />
          </div>
          {errors.fullName ? <p className="auth-field__error" id="register-name-error">{errors.fullName}</p> : null}
        </div>

        <CpfField id="register-cpf" label="CPF" value={cpf} onChange={setCpf} error={errors.cpf} />
        <PasswordField id="register-password" label="Senha" placeholder="Crie uma senha" value={password} onChange={setPassword} error={errors.password} autoComplete="new-password" />
        <PasswordField id="register-confirmation" label="Confirmar senha" placeholder="Confirme sua senha" value={confirmation} onChange={setConfirmation} error={errors.confirmation} autoComplete="new-password" />

        <p className="auth-access-note">Seu cadastro ficará <strong>pendente de aprovação</strong>. O perfil de acesso será definido pela administração.</p>

        <button className="auth-primary-button" type="submit" disabled={loading}>
          {loading ? <><LoaderCircle className="auth-spinner" aria-hidden="true" /> Cadastrando...</> : <>Cadastrar <ArrowRight aria-hidden="true" /></>}
        </button>
        <p className="auth-switch">Já tem uma conta? <Link href="/login">Entrar</Link></p>
      </form>
    </>
  );
}
