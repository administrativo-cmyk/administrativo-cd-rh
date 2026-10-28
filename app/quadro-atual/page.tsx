import { WorkforceApp } from "@/components/workforce-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { SupabaseWorkforceRepository } from "@/lib/data/supabase-workforce-repository";
import type { WorkforceEmployee } from "@/lib/workforce";

export default async function WorkforcePage() {
  const profilePromise = requireApprovedProfile();
  const employeesPromise = new SupabaseWorkforceRepository().load().catch((): WorkforceEmployee[] | null => null);
  const [profile, employees] = await Promise.all([profilePromise, employeesPromise]);
  return <WorkforceApp profile={profile} employees={employees} />;
}
