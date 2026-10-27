import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { boundedJson, monitoringSession } from "@/lib/monitoring/server";
import { historyPeriodSchema, punchCorrectionSchema } from "@/lib/monitoring/attendance-history-contracts";
import { reprocessMonitoringSnapshot } from "@/lib/monitoring/reprocess";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
import type { Json } from "@/lib/monitoring/database";
import { augmentArchivedInput } from "@/lib/monitoring/archive/server";
import { needsPeriodPunchReference, projectPeriodPunchDisplay } from "@/lib/monitoring/period-punch-display";
import { defaultScheduleSnapshotSchema } from "@/lib/monitoring/standard-schedules";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
type HistoryDatabase = { public: { Tables: Record<never, never>; Views: Record<never, never>; Enums: Record<never, never>; CompositeTypes: Record<never, never>; Functions: {
  attendance_history: { Args: { p_action: string; p_data: Json }; Returns: Json };
  employee_schedule: { Args: { p_action: string; p_data: Json }; Returns: Json };
} } };
async function rpc(action: string, data: unknown) {
  const client = await createClient<HistoryDatabase>();
  const result = await client.rpc("attendance_history", { p_action: action, p_data: data as Json });
  if (result.error) throw Object.assign(new Error("HISTORY_FAILED"), { code: result.error.code, stale: result.error.message.includes("ATTENDANCE_STALE") });
  return result.data;
}
function failure(error: unknown) {
  const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  const stale = error && typeof error === "object" && "stale" in error && error.stale;
  return Response.json({ error: stale ? "As batidas foram corrigidas em outra sessão. Atualize o histórico." : invalid || code === "22023" ? "Revise período, horários e justificativa." : code === "42501" ? "Seu perfil não permite esta operação." : "Não foi possível carregar ou salvar o histórico. Tente novamente." }, { status: stale ? 409 : invalid || code === "22023" ? 400 : code === "42501" ? 403 : 503, headers });
}
export async function GET(request: Request) {
  const session = await monitoringSession(); if (session.response) return session.response;
  try {
    const period = historyPeriodSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const raw = z.object({ input: z.unknown(), bank: z.unknown(), canEdit: z.boolean(), correctionHistory: z.array(z.unknown()) }).parse(await rpc("history", period));
    const historical = await augmentArchivedInput(raw.input,period);
    const corrections = z.object({ corrections: z.array(z.object({ date: z.string(), updatedAt: z.string() })).default([]) }).parse(raw.input).corrections;
    const days = [];
    const now = Date.now();
    for (let date = period.start; date <= period.end; date = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
      try {
        const [day] = reprocessMonitoringSnapshot(historical.input, { employeeId: period.employeeId, start: date, end: date, reason: "Consulta do histórico de ponto" }, now);
        days.push({ date, bankDay: day.summary.bankDay ?? null, workObservation: day.summary.workObservation ?? null, correctionVersion: corrections.find(row => row.date === date)?.updatedAt ?? null });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "MONITORING_FUTURE_PERIOD") throw error;
        days.push({ date, bankDay: null, correctionVersion: null });
      }
    }
    let reference = null;
    if (needsPeriodPunchReference(historical.input, period.employeeId)) {
      const client = await createClient<HistoryDatabase>();
      const result = await client.rpc("employee_schedule", { p_action: "get", p_data: { employeeId: period.employeeId, date: todayInSaoPaulo(new Date(now)) } });
      if (result.error) throw Object.assign(new Error("HISTORY_FAILED"), { code: result.error.code });
      reference = defaultScheduleSnapshotSchema.parse(result.data).setting;
    }
    const displayDays = projectPeriodPunchDisplay(historical.input, days, period.employeeId, now, reference).map(day => {
      const suggestions = day.workObservation?.suggestedMarks ?? (day.workObservation?.exitSuggestion ? [{ ...day.workObservation.exitSuggestion, role: "end" as const }] : []);
      if (!suggestions.length) return day;
      const marks = day.displayMarks ?? (day.bankDay?.slots.length ? day.bankDay.slots : day.bankDay?.punches ?? []);
      const retained = marks.filter(mark => mark.at !== null || !mark.role || !suggestions.some(s => s.role === mark.role));
      return { ...day, displayMarks: [...retained, ...suggestions.map(s => ({ ...s, origin: "turnstile" as const }))].sort((a,b) => (a.at ?? Infinity) - (b.at ?? Infinity)),
        displayReason: day.workObservation!.reason };
    });
    return Response.json({ days: displayDays, bank: raw.bank, canEdit: raw.canEdit, correctionHistory: raw.correctionHistory,...(historical.archive?{archive:historical.archive}:{}) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const session = await monitoringSession(true); if (session.response) return session.response;
  try { return Response.json(await rpc("correct", punchCorrectionSchema.parse(await boundedJson(request, 8192))), { headers }); }
  catch (error) { return failure(error); }
}
