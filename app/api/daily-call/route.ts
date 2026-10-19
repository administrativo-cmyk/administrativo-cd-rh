import { createClient } from "@/lib/supabase/server";
import { SupabaseDailyCallRepository } from "@/lib/data/supabase-daily-call-repository";
import { validDate, validPeriod } from "@/lib/data/daily-call-dates";
import { reportOperationalError } from "@/lib/security/operational-error";
import { workforceSituations, type WorkforceSituation } from "@/lib/workforce";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  const situation = url.searchParams.get("situation") || "";
  if (!validDate(date) || !validPeriod(start, end) || (situation && !workforceSituations.includes(situation as WorkforceSituation))) {
    return Response.json({ error: "Data ou período inválido (máximo de 31 dias)." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsError ? null : claims?.claims?.sub;
  if (typeof userId !== "string") return Response.json({ error: "Sessão necessária." }, { status: 401 });

  const { data: profile } = await supabase.from("perfis")
    .select("status_usuario,papel_usuario").eq("id", userId).single();
  if (!profile || !profile.papel_usuario || profile.status_usuario !== "APROVADO"
    || !["ADMIN", "RH", "GESTOR", "LEITURA"].includes(profile.papel_usuario)) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 403 });
  }

  try {
    const snapshot = await new SupabaseDailyCallRepository().load(date, start, end, situation);
    return Response.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    const correlationId = reportOperationalError("daily-call.read", cause);
    return Response.json({ error: "Não foi possível carregar a Chamada Diária.", correlationId }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
