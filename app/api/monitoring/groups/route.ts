import { groupCatalogSchema } from "@/lib/monitoring/group-catalog";
import { monitoringFailure, monitoringQuery, monitoringSession } from "@/lib/monitoring/server";

export async function GET(request: Request) {
  const scope = new URL(request.url).searchParams.get("scope");
  const session = await monitoringSession(scope !== "query");
  if (session.response) return session.response;
  if (scope !== null && scope !== "query") return Response.json({ error: "Consulta de grupos inválida." }, { status: 400 });
  try {
    const catalog = groupCatalogSchema.parse(await monitoringQuery(scope === "query" ? "filter_groups" : "groups", {}, request.signal));
    return Response.json(catalog, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return monitoringFailure(error); }
}
