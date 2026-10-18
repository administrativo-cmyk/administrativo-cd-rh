import { AdministrationApp } from "@/components/administration/administration-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
export default async function VacationPage() {
  const profile = await requireApprovedProfile();
  return <AdministrationApp profile={profile} entity="vacation" />;
}
