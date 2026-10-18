import { AppShell } from "@/components/app-shell";
import { VacationCalendar } from "@/components/planning/vacation-calendar";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";

export const metadata = { title: "Férias por Gestor e Mês | Administrativo CD" };

export default async function VacationCalendarPage() {
  const profile = await requireApprovedProfile();
  return <AppShell profile={profile} title="Férias por Gestor e Mês" activeLabel="Férias por Gestor e Mês"><VacationCalendar today={todayInSaoPaulo()} /></AppShell>;
}
