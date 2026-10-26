import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { MonitoringDatabase } from "@/lib/monitoring/database";
import { monitoringFailure, monitoringSession } from "@/lib/monitoring/server";
import { authorizedPhotoResponse } from "@/lib/monitoring/photo-storage-server";

const parameters = z.object({ sourceId: z.string().min(1).max(100), identityValue: z.string().min(1).max(100) });
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** Pre-binding review is restricted to approved ADMIN/RH in both HTTP and SQL. */
export async function GET(request: Request) {
  const session = await monitoringSession(true);
  if (session.response) return session.response;
  const input = parameters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return new Response(null, { status: 400, headers });
  try {
    const client = await createClient<MonitoringDatabase>();
    const full = new URL(request.url).searchParams.get("size") !== "avatar";
    const { data, error } = await client.rpc("monitoring_identity_photo", { p_source_id: input.data.sourceId, p_identity_value: input.data.identityValue, ...(full ? { p_variant: "full" } : {}) });
    if (error) throw Object.assign(new Error("MONITORING_PHOTO_FAILED"), { code: error.code });
    return await authorizedPhotoResponse(data);
  } catch (error) { return monitoringFailure(error); }
}
