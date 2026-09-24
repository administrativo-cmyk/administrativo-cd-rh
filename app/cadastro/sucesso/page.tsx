import type { Metadata } from "next";
import { RegistrationSuccess } from "@/components/auth/registration-success";

export const metadata: Metadata = {
  title: "Cadastro realizado | Administrativo CD",
  description: "Solicitação de acesso enviada para aprovação.",
};

export default function RegistrationSuccessPage() {
  return <RegistrationSuccess />;
}
