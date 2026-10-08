import { WorkforceApp } from "@/components/workforce-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { SupabaseWorkforceRepository } from "@/lib/data/supabase-workforce-repository";
import type { WorkforceEmployee } from "@/lib/workforce";

export default async function WorkforcePage() {
  const profile = await requireApprovedProfile();
  let employees: WorkforceEmployee[] | null = null;
  try {
    employees = await new SupabaseWorkforceRepository().load();
  } catch {
    // Never replace a failed protected read with local fixtures.
  }
  return <WorkforceApp profile={profile} employees={employees} />;
}
