import { DailyCallApp } from "@/components/daily-call-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";

export default async function Home() {
  const profile = await requireApprovedProfile();
  return <DailyCallApp profile={profile} />;
}
