import { handleImport } from "@/lib/monitoring/import-route";
export const runtime = "nodejs";
export async function POST(request: Request) { return handleImport(request, "bank"); }
