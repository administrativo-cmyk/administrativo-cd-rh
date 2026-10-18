import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { TimeBankAdminApp } from "@/components/time-bank-admin/time-bank-admin-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { bankAdminListSchema, type BankAdminSnapshot } from "@/lib/time-bank-admin/contracts";
import { loadBankAdmin } from "@/lib/time-bank-admin/server";

export const metadata: Metadata = { title: "Medições do Banco de Horas | Administrativo CD" };
export default async function Page() {
  const profile = await requireApprovedProfile(["ADMIN", "RH"]);
  let initial: BankAdminSnapshot | null = null; let error = "";
  try { initial = await loadBankAdmin(bankAdminListSchema.parse({})); }
  catch { error = "Não foi possível carregar as medições. A administração precisa concluir a instalação desta funcionalidade se ela ainda não estiver habilitada."; }
  return <AppShell profile={profile} title="Medições do Banco de Horas" activeLabel="Cadastros"><TimeBankAdminApp initial={initial} initialError={error} today={todayInSaoPaulo()} /></AppShell>;
}
