"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AnalysisFilters, AnalysisKind, AnalysisSnapshot } from "@/lib/analytics/contracts";
import { dashboardButton, dashboardDate, dashboardInput } from "@/components/dashboards/format";

export function AnalysisFiltersForm({ kind, filters, options, today }: { kind: AnalysisKind; filters: AnalysisFilters; options: AnalysisSnapshot["options"]; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <form aria-label="Filtros da análise" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of ["end", "unit", "managerId", "query"]) params.set(key, String(data.get(key) ?? ""));
    startTransition(() => router.push(`/analises/${kind}?${params}`));
  }}>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kind === "afastados-e-outros" ? <div className="text-sm text-slate-700"><p className="font-medium">Referência do quadro</p><p className="mt-3">Cadastro atual · {dashboardDate(today)}</p><input type="hidden" name="end" value={today} /></div> : <label className="text-sm font-medium text-slate-700">Data de referência<input type="date" required name="end" defaultValue={filters.end} className={dashboardInput} /></label>}
      <label className="text-sm font-medium text-slate-700">Unidade<select name="unit" defaultValue={filters.unit} className={dashboardInput}><option value="">Todas do escopo</option>{filters.unit && !options.units.includes(filters.unit) ? <option value={filters.unit}>{filters.unit}</option> : null}{options.units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Gestor<select name="managerId" defaultValue={filters.managerId} className={dashboardInput}><option value="">Todos do escopo</option><option value="none">Sem gestor</option>{filters.managerId && filters.managerId !== "none" && !options.managers.some((manager) => manager.id === filters.managerId) ? <option value={filters.managerId}>Gestor selecionado</option> : null}{options.managers.filter((manager) => manager.id !== "none").map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Colaborador<input type="search" name="query" maxLength={100} defaultValue={filters.query} placeholder="Nome ou matrícula" className={dashboardInput} /></label>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3"><button type="submit" disabled={pending} className={`${dashboardButton} border-blue-700 bg-blue-700 text-white hover:bg-blue-800`}>{pending ? "Consultando…" : "Aplicar filtros"}</button><button type="button" disabled={pending} className={dashboardButton} onClick={() => startTransition(() => router.push(`/analises/${kind}`))}>Limpar filtros</button><span role="status" aria-live="polite" className="text-xs text-slate-600">{pending ? "Atualizando análise…" : "Resultados limitados ao seu perfil de acesso."}</span></div>
  </form>;
}

export function AnalysisExport({ kind, filters }: { kind: AnalysisKind; filters: AnalysisFilters }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function download() {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/analytics/${kind}?${new URLSearchParams({ ...filters, format: "csv" })}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok || !response.headers.get("Content-Type")?.includes("text/csv")) throw new Error("Não foi possível exportar. Atualize a consulta e tente novamente.");
      const blob = await response.blob(); if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${kind}-${filters.end}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível exportar."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }
  return <div><button type="button" disabled={pending} onClick={() => void download()} className={dashboardButton}>{pending ? "Exportando…" : "Exportar CSV"}</button>{error ? <p role="alert" className="mt-2 max-w-sm text-sm text-rose-700">{error}</p> : null}</div>;
}
