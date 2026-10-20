import { groupCatalogSchema } from "@/lib/monitoring/group-catalog";
import { monitoringFailure, monitoringQuery, monitoringSession } from "@/lib/monitoring/server";

export async function GET(request: Request) {
  const session = await monitoringSession(true);
  if (session.response) return session.response;
  try {
    const catalog = groupCatalogSchema.parse(await monitoringQuery("groups", {}, request.signal));
    return Response.json(catalog, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return monitoringFailure(error); }
}
