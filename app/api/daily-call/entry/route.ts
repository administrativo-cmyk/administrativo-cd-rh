import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { attendanceCodes } from "@/lib/daily-call-types";
import { validDate } from "@/lib/data/daily-call-dates";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
import { reportOperationalError } from "@/lib/security/operational-error";

const requestSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().refine(validDate),
  status: z.enum(attendanceCodes).nullable(),
  observation: z.string().max(500).nullable(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
const resultSchema = z.object({
  changed: z.boolean(),
  record: z.object({
    date: z.string(), status: z.enum(attendanceCodes),
    observation: z.string().nullable(), updatedAt: z.string(),
  }).nullable(),
});

export async function PUT(request: Request) {
  if (!isTrustedMutationOrigin(request)) {
    return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  }
  let raw: unknown;
  try { raw = await request.json(); } catch {
    return Response.json({ error: "Dados inválidos." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Dados inválidos." }, { status: 400 });
  const input = parsed.data;
  const observation = input.observation?.trim() || null;
  if (input.status === null && observation !== null) {
    return Response.json({ error: "Selecione um status antes de adicionar observação." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsError ? null : claims?.claims?.sub;
  if (typeof userId !== "string") return Response.json({ error: "Sessão necessária." }, { status: 401 });
  const { data: profile } = await supabase.from("perfis")
    .select("status_usuario,papel_usuario").eq("id", userId).single();
  if (!profile || !profile.papel_usuario || profile.status_usuario !== "APROVADO"
    || !["ADMIN", "RH", "GESTOR"].includes(profile.papel_usuario)) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("salvar_chamada_diaria", {
    p_colaborador_id: input.employeeId,
    p_data: input.date,
    p_status: input.status,
    p_observacao: observation,
    p_expected_updated_at: input.expectedUpdatedAt,
  });
  if (error) {
    const status = error.code === "PT409" ? 409 : error.code === "42501" ? 403
      : ["22023", "22P02"].includes(error.code) ? 400 : 503;
    const message = status === 409 ? "Este lançamento foi alterado por outro usuário. Atualize os dados e tente novamente."
      : status === 400 ? "Lançamento inválido para este colaborador ou data."
        : status === 403 ? "Acesso não autorizado." : "Não foi possível salvar o lançamento.";
    const correlationId = reportOperationalError("daily-call.write", error);
    return Response.json({ error: message, correlationId }, { status, headers: { "Cache-Control": "no-store" } });
  }
  const result = resultSchema.safeParse(data);
  if (!result.success) return Response.json({ error: "Resposta inválida ao salvar lançamento." }, { status: 503 });
  return Response.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
}
