import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth/auth-layout";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Login | Administrativo CD",
  description: "Acesso ao ambiente do Administrativo CD.",
};

export default function LoginPage() {
  return <AuthLayout variant="login"><LoginForm /></AuthLayout>;
}
