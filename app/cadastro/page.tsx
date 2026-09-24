import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth/auth-layout";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Cadastro | Administrativo CD",
  description: "Solicite acesso ao ambiente do Administrativo CD.",
};

export default function RegisterPage() {
  return <AuthLayout variant="register"><RegisterForm /></AuthLayout>;
}
