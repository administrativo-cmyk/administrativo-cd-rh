import { CheckCircle2, RotateCcw, Undo2 } from "lucide-react";
import { getBankHoursSummary } from "@/lib/daily-call-rules";
import type { Employee } from "@/lib/daily-call-types";

type Display = "combined" | "situation" | "pending";

export function BankHoursBadge({ employee, compact = false, display = "combined" }: { employee: Employee; compact?: boolean; display?: Display }) {
  const summary = getBankHoursSummary(employee);
  if (summary.situation === "Sem extrato") return <span className="inline-flex whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">Sem extrato</span>;
  if (display === "situation") return <Situation situation={summary.situation} />;
  if (summary.situation === "A compensar") return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200"><RotateCcw size={12} />{compact ? `${summary.pendingCompensationDays}d` : display === "pending" ? `${summary.pendingCompensationDays} ${summary.pendingCompensationDays === 1 ? "dia" : "dias"}` : `A compensar: ${summary.pendingCompensationDays} ${summary.pendingCompensationDays === 1 ? "dia" : "dias"}`}</span>;
  if (summary.situation === "A repor") return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200"><Undo2 size={12} />{compact ? `${summary.replacementDays}d` : display === "pending" ? `${summary.replacementDays} ${summary.replacementDays === 1 ? "dia" : "dias"}` : `Repor ${summary.replacementDays} ${summary.replacementDays === 1 ? "dia" : "dias"}`}</span>;
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200"><CheckCircle2 size={12} />Em dia</span>;
}

function Situation({ situation }: { situation: ReturnType<typeof getBankHoursSummary>["situation"] }) {
  const tone = situation === "A compensar" ? "bg-rose-50 text-rose-700 ring-rose-200" : situation === "A repor" ? "bg-blue-50 text-blue-700 ring-blue-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tone}`}>{situation}</span>;
}
