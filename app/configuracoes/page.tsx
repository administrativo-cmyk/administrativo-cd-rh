import { SettingsApp } from "@/components/workspace/settings-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
export default async function SettingsPage(){const profile=await requireApprovedProfile();return <SettingsApp profile={profile}/>;}
