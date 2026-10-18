import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { MonitoringDatabase } from "@/lib/monitoring/database";
import { monitoringFailure, monitoringSession } from "@/lib/monitoring/server";

const parameters = z.object({ sourceId: z.string().min(1).max(100), identityValue: z.string().min(1).max(100) });
const photo = z.object({ mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), base64: z.string().max(2800000), sha256: z.string() }).nullable();
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** Pre-binding review is restricted to approved ADMIN/RH in both HTTP and SQL. */
export async function GET(request: Request) {
  const session = await monitoringSession(true);
  if (session.response) return session.response;
  const input = parameters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return new Response(null, { status: 400, headers });
  try {
    const client = await createClient<MonitoringDatabase>();
    const { data, error } = await client.rpc("monitoring_identity_photo", { p_source_id: input.data.sourceId, p_identity_value: input.data.identityValue });
    if (error) throw Object.assign(new Error("MONITORING_PHOTO_FAILED"), { code: error.code });
    const image = photo.parse(data);
    if (!image) return new Response(null, { status: 404, headers });
    return new Response(Buffer.from(image.base64, "base64"), { headers: { ...headers, "Content-Type": image.mimeType } });
  } catch (error) { return monitoringFailure(error); }
}
