export function GET() { return Response.json({ service: "administrativo-cd-rh", status: "ready" }, { headers: { "Cache-Control": "no-store" } }); }
