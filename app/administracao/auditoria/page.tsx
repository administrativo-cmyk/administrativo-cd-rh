import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { AuditHistoryApp } from "@/components/audit/audit-history-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { defaultAuditQuery } from "@/lib/audit/contracts";
export const metadata: Metadata = { title: "Histórico de alterações | Administrativo CD" };
export default async function Page() {
 const profile = await requireApprovedProfile(["ADMIN", "RH"]);
 return <AppShell profile={profile} title="Histórico de alterações" activeLabel="Histórico de alterações"><AuditHistoryApp initialQuery={defaultAuditQuery(todayInSaoPaulo())} isAdmin={profile.papel_usuario === "ADMIN"} /></AppShell>;
}
