import type { Metadata } from "next";
import { AccessStatus } from "@/components/auth/access-status";

export const metadata: Metadata = {
  title: "Acesso bloqueado | Administrativo CD",
  description: "Acesso bloqueado pela administração responsável.",
};

export default function BlockedAccessPage() {
  return <AccessStatus variant="blocked" />;
}
