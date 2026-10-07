import { DailyCallApp } from "@/components/daily-call-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { SupabaseDailyCallRepository } from "@/lib/data/supabase-daily-call-repository";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { filtersForDate } from "@/lib/daily-call-selectors";
import type { DailyCallSnapshot } from "@/lib/daily-call-types";

export default async function Home() {
  const profile = await requireApprovedProfile();
  const date = todayInSaoPaulo();
  const period = filtersForDate(date);
  let snapshot: DailyCallSnapshot | null = null;
  try {
    snapshot = await new SupabaseDailyCallRepository().load(date, period.startDate, period.endDate);
  } catch {
    // The UI shows an explicit error state; it must never fall back to fixtures.
  }
  return <DailyCallApp profile={profile} initialDate={date} initialSnapshot={snapshot} />;
}
