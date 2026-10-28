import { TimeBankApp } from "@/components/time-bank-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { SupabaseTimeBankRepository } from "@/lib/data/supabase-time-bank-repository";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import type { TimeBankSnapshot } from "@/lib/time-bank";

export default async function TimeBankPage() {
  const profilePromise = requireApprovedProfile();
  const snapshotPromise = new SupabaseTimeBankRepository().load(todayInSaoPaulo()).catch((): TimeBankSnapshot | null => null);
  const [profile, snapshot] = await Promise.all([profilePromise, snapshotPromise]);
  return <TimeBankApp profile={profile} snapshot={snapshot} />;
}
