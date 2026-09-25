"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, LoaderCircle, UserRound } from "lucide-react";
import { CpfField } from "@/components/auth/cpf-field";
import { PasswordField } from "@/components/auth/password-field";
import { validateRegistration, type RegistrationErrors } from "@/lib/auth/auth-validation";
import { AuthFlowError, type AuthService } from "@/lib/auth/auth-service";
import { supabaseAuthService } from "@/lib/auth/supabase-auth-service";

type RegisterFormProps = {
  service?: AuthService;
};

export function RegisterForm({ service = supabaseAuthService }: RegisterFormProps) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateRegistration({ fullName, cpf, password, confirmation });

    setErrors(nextErrors);
    setFeedback("");
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      const result = await service.signUp({ fullName: fullName.trim(), cpf, password });
      if (result.status === "PENDENTE") router.push("/cadastro/sucesso");
    } catch (error) {
      setFeedback(error instanceof AuthFlowError ? error.message : "Não foi possível concluir o cadastro. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="auth-form-heading auth-form-heading--register">
        <h1>Crie sua conta</h1>
        <p>Junte-se a uma plataforma feita para valorizar pessoas e simplificar a gestão de talentos.</p>
      </div>

      <form className="auth-form auth-form--register" onSubmit={handleSubmit} noValidate>
        <div className="auth-field">
          <label htmlFor="register-name">Nome</label>
          <div className={`auth-input-wrap${errors.fullName ? " auth-input-wrap--error" : ""}`}>
            <UserRound aria-hidden="true" />
            <input id="register-name" name="name" type="text" autoComplete="name" placeholder="Digite seu nome completo" value={fullName} onChange={(event) => setFullName(event.target.value)} aria-invalid={Boolean(errors.fullName)} aria-describedby={errors.fullName ? "register-name-error" : undefined} />
          </div>
          {errors.fullName ? <p className="auth-field__error" id="register-name-error">{errors.fullName}</p> : null}
        </div>

        <CpfField id="register-cpf" label="Usuário" value={cpf} onChange={setCpf} error={errors.cpf} />
        <PasswordField id="register-password" label="Senha" placeholder="Crie uma senha" value={password} onChange={setPassword} error={errors.password} autoComplete="new-password" />
        <PasswordField id="register-confirmation" label="Confirmar senha" placeholder="Confirme sua senha" value={confirmation} onChange={setConfirmation} error={errors.confirmation} autoComplete="new-password" />

        <button className="auth-primary-button" type="submit" disabled={loading}>
          {loading ? <><LoaderCircle className="auth-spinner" aria-hidden="true" /> Cadastrando...</> : <>Cadastrar <ArrowRight aria-hidden="true" /></>}
        </button>
        {feedback ? <p className="auth-feedback auth-feedback--error" role="alert"><CircleAlert aria-hidden="true" /> {feedback}</p> : null}
        <p className="auth-switch">Já tem uma conta? <Link href="/login">Entrar</Link></p>
      </form>
    </>
  );
}
