import { DailyCallApp } from "@/components/daily-call-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { SupabaseDailyCallRepository } from "@/lib/data/supabase-daily-call-repository";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { filtersForDate } from "@/lib/daily-call-selectors";
import type { DailyCallSnapshot } from "@/lib/daily-call-types";

export default async function DailyCallPage() {
  const date = todayInSaoPaulo();
  const period = filtersForDate(date);
  const profilePromise = requireApprovedProfile();
  const snapshotPromise = new SupabaseDailyCallRepository().load(date, period.startDate, period.endDate).catch((): DailyCallSnapshot | null => null);
  const [profile, snapshot] = await Promise.all([profilePromise, snapshotPromise]);
  return <DailyCallApp profile={profile} initialDate={date} initialSnapshot={snapshot} />;
}
