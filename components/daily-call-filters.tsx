"use client";

import { useState } from "react";
import { ChevronDown, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import type { DailyCallFilters as FilterValues } from "@/lib/daily-call-types";
import { managerOptions } from "@/lib/mock-daily-call";
import { cn } from "@/lib/utils";

type Props = { filters: FilterValues; activeCount: number; updateFilter: <K extends keyof FilterValues>(key: K, value: FilterValues[K]) => void; clearFilters: () => void };
const controlClass = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

export function DailyCallFilters({ filters, activeCount, updateFilter, clearFilters }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return <section aria-label="Filtros da chamada" className={cn("rounded-xl border bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/4%)] transition", activeCount ? "border-blue-200 ring-1 ring-blue-100" : "border-slate-200")}>
    <div className={cn("flex items-center justify-between gap-3", mobileOpen && "mb-2", "md:mb-2")}><button type="button" aria-expanded={mobileOpen} aria-label={mobileOpen ? "Ocultar filtros" : "Mostrar filtros"} onClick={() => setMobileOpen((value) => !value)} className="flex items-center gap-2 text-xs font-semibold text-slate-600 md:pointer-events-none"><SlidersHorizontal size={14} />Filtros{activeCount ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">{activeCount} {activeCount === 1 ? "ativo" : "ativos"}</span> : null}<ChevronDown size={14} className={cn("ml-1 transition md:hidden", mobileOpen && "rotate-180")} /></button><button onClick={clearFilters} disabled={!activeCount} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 disabled:pointer-events-none disabled:opacity-35"><RotateCcw size={13} />Limpar</button></div>
    <div className={cn("gap-2.5 md:grid md:grid-cols-2 xl:grid-cols-[0.75fr_1fr_1.3fr_1fr_1fr_1.45fr]", mobileOpen ? "grid" : "hidden")}>
      <FilterLabel label="Unidade"><select aria-label="Unidade" className={controlClass} value={filters.unit} onChange={(event) => updateFilter("unit", event.target.value as FilterValues["unit"])}><option>Todas</option><option>CD I</option><option>CD II</option><option>CD FLV</option></select></FilterLabel>
      <FilterLabel label="Gestor"><select aria-label="Gestor" className={controlClass} value={filters.manager} onChange={(event) => updateFilter("manager", event.target.value)}><option value="Todos">Todos os gestores</option>{managerOptions.map((manager) => <option key={manager}>{manager}</option>)}</select></FilterLabel>
      <FilterLabel label="Colaborador"><div className="relative"><Search className="absolute left-2.5 top-2.5 text-slate-400" size={14} /><input aria-label="Buscar colaborador" className={`${controlClass} pl-8`} placeholder="Nome ou matrícula" value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} /></div></FilterLabel>
      <FilterLabel label="Situação BH"><select aria-label="Situação do banco" className={controlClass} value={filters.bank} onChange={(event) => updateFilter("bank", event.target.value as FilterValues["bank"])}><option>Todos</option><option>Em dia</option><option>A compensar</option><option>A repor</option></select></FilterLabel>
      <FilterLabel label="Status"><select aria-label="Status da chamada" className={controlClass} value={filters.status} onChange={(event) => updateFilter("status", event.target.value as FilterValues["status"])}>{["Todos", "Presente", "Folga", "Atestado", "Injustificado", "Férias", "INSS", "Outros"].map((option) => <option key={option}>{option}</option>)}</select></FilterLabel>
      <FilterLabel label="Período"><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1"><input aria-label="Data inicial" type="date" className={`${controlClass} px-2 text-xs`} value={filters.startDate} onChange={(event) => updateFilter("startDate", event.target.value)} /><span className="text-slate-400">–</span><input aria-label="Data final" type="date" className={`${controlClass} px-2 text-xs`} value={filters.endDate} onChange={(event) => updateFilter("endDate", event.target.value)} /></div></FilterLabel>
    </div>
  </section>;
}

function FilterLabel({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1"><span className="block text-[11px] font-semibold text-slate-500">{label}</span>{children}</label>; }
