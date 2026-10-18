import "server-only";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { SupabaseTimeBankRepository } from "@/lib/data/supabase-time-bank-repository";
import { SupabaseWorkforceRepository } from "@/lib/data/supabase-workforce-repository";
import { analysisSnapshotSchema, parseAnalysisFilters, type AnalysisFilters, type AnalysisKind, type AnalysisSnapshot } from "./contracts";
import { buildBankAnalysis, buildOutsideWorkforceAnalysis } from "./selectors";

/** Reads use cookie-session RPCs; scope remains enforced by the database. */
export async function loadAnalysis(kind: AnalysisKind, input: Partial<AnalysisFilters> = {}): Promise<AnalysisSnapshot> {
  const filters = parseAnalysisFilters(kind, input, todayInSaoPaulo());
  const at = new Date().toISOString();
  const result = kind === "afastados-e-outros"
    ? buildOutsideWorkforceAnalysis(await new SupabaseWorkforceRepository().load(), filters, at)
    : buildBankAnalysis(kind, await new SupabaseTimeBankRepository().load(filters.end), filters, at);
  return analysisSnapshotSchema.parse(result);
}
