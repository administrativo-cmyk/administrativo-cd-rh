import { NotificationsApp } from "@/components/workspace/notifications-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
export default async function NotificationsPage({searchParams}:{searchParams:Promise<{view?:string}>}){const [profile,params]=await Promise.all([requireApprovedProfile(),searchParams]);return <NotificationsApp profile={profile} initialManage={params.view==="notices"}/>;}
