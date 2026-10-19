import { z } from "zod";
import { dateSchema } from "@/lib/monitoring/contracts";
import { defaultScheduleSaveSchema, defaultScheduleSnapshotSchema } from "@/lib/monitoring/standard-schedules";
import { boundedJson, monitoringSession } from "@/lib/monitoring/server";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/monitoring/database";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
type Database = { public: { Tables: Record<never, never>; Views: Record<never, never>; Enums: Record<never, never>; CompositeTypes: Record<never, never>; Functions: { employee_schedule: { Args: { p_action: string; p_data: Json }; Returns: Json } } } };
const readSchema = z.object({ employeeId: z.string().uuid(), date: dateSchema }).strict();
export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const session = await monitoringSession(); if (session.response) return session.response;
  let input: unknown; try { input = await boundedJson(request, 16384); } catch { return Response.json({ error: "Conteúdo inválido." }, { status: 400 }); }
  const envelope = z.object({ action: z.enum(["get", "save"]), data: z.unknown() }).strict().safeParse(input);
  if (!envelope.success) return Response.json({ error: "Operação inválida." }, { status: 400 });
  const { action } = envelope.data;
  const parsed = (action === "get" ? readSchema : defaultScheduleSaveSchema).safeParse(envelope.data.data);
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map(i => i.message).join(" · ") }, { status: 400 });
  try {
    const client = await createClient<Database>();
    const { data, error } = await client.rpc("employee_schedule", { p_action: action, p_data: parsed.data as Json });
    if (error) {
      const stale = error.message.includes("SCHEDULE_STALE");
      return Response.json({ error: stale ? "O horário mudou. Recarregue o cadastro antes de salvar." : error.code === "42501" ? "Colaborador fora do seu acesso." : "Não foi possível salvar. Confira a vigência e os campos." }, { status: stale ? 409 : error.code === "42501" ? 403 : 409 });
    }
    return Response.json(defaultScheduleSnapshotSchema.parse(data), { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "Não foi possível carregar o horário." }, { status: 503 }); }
}
