import type { Metadata } from "next";
import { UsersAdminPage } from "@/components/users/users-admin-page";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";

export const metadata: Metadata = {
  title: "Usuários | Administrativo CD",
  description: "Aprovação e controle de acessos do Administrativo CD.",
};

export default async function UsersPage() {
  const profile = await requireApprovedProfile(["ADMIN", "RH"]);
  return <UsersAdminPage profile={profile} />;
}
