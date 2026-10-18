"use client";

import { useState } from "react";
import type { DashboardSnapshot } from "@/lib/dashboards/contracts";
import { dashboardButton, dashboardDate, dashboardValue } from "./format";

const pageSize = 12;

export function DashboardChart({ chart }: { chart: DashboardSnapshot["charts"][number] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(chart.points.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = chart.points.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const maximum = Math.max(1, ...chart.points.map((point) => Math.abs(point.value ?? 0)));
  const signed = chart.points.some((point) => point.value !== null && point.value < 0);
  return <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label={chart.title}>
    <h2 className="text-base font-semibold text-slate-950">{chart.title}</h2>
    <p className="mt-1 text-sm leading-relaxed text-slate-600">{chart.description}</p>
    {chart.points.length ? <>
      <ul className="mt-5 space-y-4" aria-label={`Valores de ${chart.title}`}>
        {visible.map((point, index) => {
          const width = point.value === null ? 0 : Math.abs(point.value) / maximum * (signed ? 50 : 100);
          return <li key={`${point.label}-${index}`}>
            <div className="mb-1.5 flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words text-slate-700">{dashboardDate(point.label)}</span><b className="shrink-0 tabular-nums text-slate-950">{dashboardValue(point.value, chart.format)}</b></div>
            <div aria-hidden="true" className="relative h-3 overflow-hidden rounded bg-slate-100">
              {signed ? <span className="absolute inset-y-0 left-1/2 border-l border-slate-400" /> : null}
              {point.value !== null ? <span className={`absolute inset-y-0 rounded-sm ${point.value < 0 ? "bg-amber-600" : "bg-blue-600"}`} style={{ width: `${width}%`, left: `${signed ? point.value < 0 ? 50 - width : 50 : 0}%` }} /> : null}
            </div>
          </li>;
        })}
      </ul>
      {signed ? <p className="mt-4 text-xs text-slate-600">A linha central representa zero. Valores negativos aparecem à esquerda.</p> : null}
      {pages > 1 ? <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3"><p className="text-xs text-slate-600">{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, chart.points.length)} de {chart.points.length} categorias</p><div className="flex gap-2"><button type="button" aria-label={`Categorias anteriores de ${chart.title}`} className={dashboardButton} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><button type="button" aria-label={`Próximas categorias de ${chart.title}`} className={dashboardButton} disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Próximas</button></div></div> : null}
    </> : <p className="mt-5 rounded-lg bg-slate-50 p-5 text-sm text-slate-600">Nenhum dado disponível para este gráfico com os filtros aplicados.</p>}
  </section>;
}
