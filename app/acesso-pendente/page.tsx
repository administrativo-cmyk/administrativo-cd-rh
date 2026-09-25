import type { Metadata } from "next";
import { AccessStatus } from "@/components/auth/access-status";

export const metadata: Metadata = {
  title: "Acesso pendente | Administrativo CD",
  description: "Acesso aguardando aprovação.",
};

export default function PendingAccessPage() {
  return <AccessStatus variant="pending" />;
}
