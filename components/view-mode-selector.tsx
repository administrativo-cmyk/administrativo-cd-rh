import { CalendarDays, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

export function ViewModeSelector({ value, onChange }: { value: "today" | "period"; onChange: (value: "today" | "period") => void }) {
  return <div role="group" aria-label="Modo de visualização" className="flex rounded-lg bg-slate-100 p-1"><button aria-pressed={value === "today"} onClick={() => onChange("today")} className={cn("inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition", value === "today" ? "bg-white font-semibold text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}><CalendarDays size={15} />Hoje</button><button aria-pressed={value === "period"} onClick={() => onChange("period")} className={cn("inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition", value === "period" ? "bg-white font-semibold text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}><CalendarRange size={15} />Período</button></div>;
}
