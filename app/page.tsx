import { redirect } from "next/navigation";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { workspaceQuery } from "@/lib/workspace/server";
import type { WorkspaceSettings } from "@/lib/workspace/contracts";

export default async function Home() {
  await requireApprovedProfile();
  let dashboard = "index";
  try { dashboard = (await workspaceQuery<WorkspaceSettings>("settings")).defaultDashboard; } catch { /* Keep entry available while preferences are unavailable. */ }
  redirect(dashboard === "index" ? "/dashboards" : `/dashboards/${dashboard}`);
}
