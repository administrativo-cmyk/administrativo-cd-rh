import { BriefcaseBusiness, CircleAlert, CircleCheckBig, Coffee, RefreshCcw, Undo2 } from "lucide-react";
import type { DailyCallMetrics as Metrics } from "@/lib/daily-call-types";

export function DailyCallMetrics({ metrics }: { metrics: Metrics }) {
  const items = [
    ["Colaboradores", metrics.collaborators, BriefcaseBusiness, "text-slate-600 bg-slate-100"], ["Presentes", metrics.present, CircleCheckBig, "text-emerald-700 bg-emerald-50"],
    ["Folgas", metrics.daysOff, Coffee, "text-amber-700 bg-amber-50"], ["Ausências", metrics.absences, CircleAlert, "text-rose-700 bg-rose-50"],
    ["A compensar", metrics.compensate, RefreshCcw, "text-rose-700 bg-rose-50"], ["A repor", metrics.replace, Undo2, "text-blue-700 bg-blue-50"],
  ] as const;
  return <section aria-label="Indicadores" className="grid grid-cols-3 gap-2 md:grid-cols-6">{items.map(([label, value, Icon, tone]) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-[0_1px_2px_rgb(15_23_42/4%)] sm:p-3"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.04em] text-slate-500 sm:text-[10px]">{label}</p><p className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">{value}</p></div><span className={`hidden h-7 w-7 shrink-0 place-items-center rounded-lg xl:grid ${tone}`}><Icon size={14} /></span></div></article>)}</section>;
}
