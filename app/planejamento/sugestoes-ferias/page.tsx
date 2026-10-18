import { PlanningApp } from "@/components/planning/planning-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
export default async function SuggestionsPage(){const profile=await requireApprovedProfile();return <PlanningApp profile={profile} mode="vacations" today={todayInSaoPaulo()}/>;}
