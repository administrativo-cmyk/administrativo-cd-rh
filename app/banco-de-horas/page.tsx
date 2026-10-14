import { TimeBankApp } from "@/components/time-bank-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { SupabaseTimeBankRepository } from "@/lib/data/supabase-time-bank-repository";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import type { TimeBankSnapshot } from "@/lib/time-bank";

export default async function TimeBankPage() {
  const profile = await requireApprovedProfile();
  let snapshot: TimeBankSnapshot | null = null;
  try {
    snapshot = await new SupabaseTimeBankRepository().load(todayInSaoPaulo());
  } catch {
    // A protected read failure must never fall back to local fixtures.
  }
  return <TimeBankApp profile={profile} snapshot={snapshot} />;
}
