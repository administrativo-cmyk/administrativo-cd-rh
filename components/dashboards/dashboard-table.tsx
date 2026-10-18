"use client";

import { useMemo, useState } from "react";
import type { DashboardSnapshot } from "@/lib/dashboards/contracts";
import { dashboardButton, dashboardDate, dashboardValue } from "./format";

const pageSize = 20;
type Table = DashboardSnapshot["table"];

function cell(value: string | number | null | undefined, column: Table["columns"][number]) {
  if (value === null || value === undefined) return column.format ? "Não apurável" : "Não informado";
  return typeof value === "number" ? dashboardValue(value, column.format) : dashboardDate(value);
}

export function DashboardTable({ table }: { table: Table }) {
  const [page, setPage] = useState(0);
  const [order, setOrder] = useState<{ key: string; descending: boolean } | null>(null);
  const sorted = useMemo(() => {
    if (!order) return table.rows;
    return [...table.rows].sort((left, right) => {
      const a = left[order.key]; const b = right[order.key];
      if (a == null) return b == null ? 0 : 1;
      if (b == null) return -1;
      const comparison = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "pt-BR", { numeric: true });
      return order.descending ? -comparison : comparison;
    });
  }, [table.rows, order]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  function sort(key: string) { setOrder((previous) => ({ key, descending: previous?.key === key ? !previous.descending : false })); setPage(0); }
  return <section aria-labelledby="dashboard-table-title" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-200 p-4 sm:p-5"><h2 id="dashboard-table-title" className="text-base font-semibold text-slate-950">Dados do painel</h2><p className="mt-1 text-sm text-slate-600">{table.rows.length} registro(s) na consulta. A exportação inclui todos os registros consultados.</p></div>
    {visible.length ? <>
      <div className="p-4 md:hidden"><label className="text-sm font-medium text-slate-700">Ordenar por<select className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" value={order?.key ?? ""} onChange={(event) => { setOrder(event.target.value ? { key: event.target.value, descending: false } : null); setPage(0); }}><option value="">Ordem do painel</option>{table.columns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}</select></label>{order ? <button type="button" className={`${dashboardButton} mt-2 w-full`} onClick={() => { setOrder({ ...order, descending: !order.descending }); setPage(0); }}>Ordem {order.descending ? "decrescente" : "crescente"} · inverter</button> : null}</div>
      <div className="divide-y divide-slate-200 md:hidden">{visible.map((row, index) => <dl key={index} className="space-y-2 p-4">{table.columns.map((column) => <div key={column.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 text-sm"><dt className="break-words text-slate-600">{column.label}</dt><dd className="min-w-0 break-words font-medium text-slate-950">{cell(row[column.key], column)}</dd></div>)}</dl>)}</div>
      <div className="hidden max-w-full overflow-x-auto md:block"><table className="w-full text-left text-sm"><caption className="sr-only">Dados completos do dashboard, paginados em {pageSize} registros</caption><thead className="border-b border-slate-200 bg-slate-50"><tr>{table.columns.map((column) => <th scope="col" key={column.key} aria-sort={order?.key === column.key ? order.descending ? "descending" : "ascending" : "none"} className="min-w-28 px-4 text-xs font-semibold text-slate-600"><button type="button" className="flex min-h-11 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-blue-700" onClick={() => sort(column.key)}>{column.label}{order?.key === column.key ? <span aria-hidden="true">{order.descending ? "↓" : "↑"}</span> : null}</button></th>)}</tr></thead><tbody className="divide-y divide-slate-100">{visible.map((row, index) => <tr key={index} className="hover:bg-slate-50">{table.columns.map((column) => <td key={column.key} className="px-4 py-3 text-slate-800"><span className={typeof row[column.key] === "number" ? "whitespace-nowrap tabular-nums" : "block min-w-24 max-w-72 break-words"}>{cell(row[column.key], column)}</span></td>)}</tr>)}</tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4"><p className="text-sm text-slate-600">{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, sorted.length)} de {sorted.length}</p><div className="flex items-center gap-2"><button type="button" className={dashboardButton} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><span className="text-xs text-slate-600">{currentPage + 1} / {pages}</span><button type="button" className={dashboardButton} disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Próxima</button></div></div>
    </> : <p className="p-8 text-center text-sm text-slate-600">Nenhum registro encontrado para os filtros aplicados.</p>}
  </section>;
}
