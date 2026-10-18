import { PlanningApp } from "@/components/planning/planning-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
export default async function SchedulesPage(){const profile=await requireApprovedProfile();return <PlanningApp profile={profile} mode="schedules" today={todayInSaoPaulo()}/>;}
