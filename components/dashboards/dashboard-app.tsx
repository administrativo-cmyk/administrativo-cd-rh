"use client";

import Link from "@/components/navigation-link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Download, RefreshCw, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { dashboardSnapshotSchema, defaultDashboardFilters, parseDashboardFilters, type DashboardDomain, type DashboardFilters, type DashboardSnapshot } from "@/lib/dashboards/contracts";
import { dashboardCatalog, dashboardDefinition } from "./catalog";
import { DashboardChart } from "./dashboard-chart";
import { DashboardTable } from "./dashboard-table";
import { dashboardButton, dashboardDate, dashboardInput, dashboardInstant, dashboardValue } from "./format";

type Props = { domain: DashboardDomain; today: string; initialFilters: DashboardFilters; initialSnapshot: DashboardSnapshot | null; initialError?: string };

function queryString(filters: DashboardFilters) { return new URLSearchParams(filters).toString(); }
async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return `${typeof body.error === "string" ? body.error : "Não foi possível carregar os dados."}${typeof body.correlationId === "string" ? ` Referência: ${body.correlationId}` : ""}`;
  } catch { return "Não foi possível carregar os dados. Tente novamente."; }
}

export function DashboardApp({ domain, today, initialFilters, initialSnapshot, initialError = "" }: Props) {
  const definition = dashboardDefinition(domain);
  const [draft, setDraft] = useState(initialFilters);
  const [applied, setApplied] = useState(initialFilters);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [revision, setRevision] = useState(0);
  const currentRequest = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => () => { currentRequest.current++; requestController.current?.abort(); exportController.current?.abort(); }, []);
  const period = domain === "monitoramento" || domain === "chamada-diaria";
  const options = snapshot?.options ?? { units: [], managers: [] };

  async function load(next: DashboardFilters) {
    let filters: DashboardFilters;
    try { filters = parseDashboardFilters(domain, next, today); }
    catch { setError(period ? `Revise as datas. O período deve ter início anterior ou igual ao fim e até ${domain === "chamada-diaria" ? 31 : 367} dias.` : "Revise a data e os filtros informados."); return; }
    requestController.current?.abort();
    const controller = new AbortController(); requestController.current = controller;
    const request = ++currentRequest.current;
    setLoading(true); setError(""); setExportError("");
    try {
      const response = await fetch(`/api/dashboards/${domain}?${queryString(filters)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response));
      const parsed = dashboardSnapshotSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.domain !== domain) throw new Error("O painel retornou dados incompatíveis. Atualize a consulta.");
      if (request !== currentRequest.current || controller.signal.aborted) return;
      setSnapshot(parsed.data); setApplied(filters);
      setDraft((previous) => (Object.keys(next) as Array<keyof DashboardFilters>).every((key) => previous[key] === next[key]) ? filters : previous);
      setRevision((value) => value + 1);
      window.history.replaceState(null, "", `/dashboards/${domain}?${queryString(filters)}`);
    } catch (cause) {
      if (request === currentRequest.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o painel.");
    } finally { if (request === currentRequest.current && !controller.signal.aborted) setLoading(false); }
  }

  async function exportCsv() {
    if (!snapshot) return;
    const controller = new AbortController(); exportController.current = controller;
    setExporting(true); setExportError("");
    try {
      const response = await fetch(`/api/dashboards/${domain}?${queryString(applied)}&format=csv`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response));
      if (!response.headers.get("Content-Type")?.includes("text/csv")) throw new Error("Não foi possível gerar o arquivo CSV.");
      const blob = await response.blob(); if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${domain}-${applied.start}-${applied.end}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (cause) { if (!controller.signal.aborted) setExportError(cause instanceof Error ? cause.message : "Não foi possível exportar."); }
    finally { if (!controller.signal.aborted) setExporting(false); }
  }

  function change(key: keyof DashboardFilters, value: string) { setDraft((previous) => ({ ...previous, [key]: value })); }
  const periodLabel = snapshot ? snapshot.start === snapshot.end ? dashboardDate(snapshot.end) : `${dashboardDate(snapshot.start)} a ${dashboardDate(snapshot.end)}` : "Nenhuma consulta concluída";

  return <div className="mx-auto min-w-0 max-w-[1600px] space-y-5">
    <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div className="max-w-3xl"><Link href="/dashboards" className="inline-flex min-h-11 items-center text-xs font-bold uppercase tracking-widest text-blue-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-blue-700">Dashboards</Link><h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{definition.title}</h1><p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">{snapshot?.description ?? definition.detail}</p></div>
      <Link href={definition.operationHref} className={dashboardButton}>Abrir {definition.title}<ArrowUpRight aria-hidden="true" size={16} /></Link>
    </header>
    <nav aria-label="Dashboards por área" className="flex flex-wrap gap-2">{dashboardCatalog.map((entry) => <Link key={entry.key} href={`/dashboards/${entry.key}`} aria-current={domain === entry.key ? "page" : undefined} className={cn(dashboardButton, domain === entry.key && "border-blue-700 bg-blue-700 text-white hover:bg-blue-800")}>{entry.title}</Link>)}</nav>

    <form aria-label={`Filtros do dashboard de ${definition.title}`} onSubmit={(event) => { event.preventDefault(); void load(draft); }} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-950"><SlidersHorizontal aria-hidden="true" size={17} />Filtros da consulta</div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {period ? <><label className="text-sm font-medium text-slate-700">De<input name="start" autoComplete="off" type="date" required className={dashboardInput} value={draft.start} onChange={(event) => change("start", event.target.value)} /></label><label className="text-sm font-medium text-slate-700">Até<input name="end" autoComplete="off" type="date" required className={dashboardInput} value={draft.end} onChange={(event) => change("end", event.target.value)} /></label></> : domain === "banco-de-horas" ? <label className="text-sm font-medium text-slate-700">Data de referência<input name="end" autoComplete="off" type="date" required className={dashboardInput} value={draft.end} onChange={(event) => setDraft((previous) => ({ ...previous, start: event.target.value, end: event.target.value }))} /></label> : <div className="text-sm text-slate-700"><span className="font-medium">Referência do quadro</span><p className="mt-3">Cadastro atual · {dashboardDate(today)}</p></div>}
        <label className="text-sm font-medium text-slate-700">Unidade<select name="unit" className={dashboardInput} value={draft.unit} onChange={(event) => change("unit", event.target.value)}><option value="">Todas do escopo</option>{draft.unit && !options.units.includes(draft.unit) ? <option value={draft.unit}>{draft.unit}</option> : null}{options.units.map((unit) => <option value={unit} key={unit}>{unit}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Gestor<select name="managerId" className={dashboardInput} value={draft.managerId} onChange={(event) => change("managerId", event.target.value)}><option value="">Todos do escopo</option><option value="none">Sem vínculo de gestor</option>{draft.managerId && draft.managerId !== "none" && !options.managers.some((manager) => manager.id === draft.managerId) ? <option value={draft.managerId}>Gestor selecionado</option> : null}{options.managers.filter(manager => manager.id !== "none").map((manager) => <option value={manager.id} key={manager.id}>{manager.name}</option>)}</select></label>
        <label className={`text-sm font-medium text-slate-700 ${period ? "" : "xl:col-span-2"}`}>Colaborador<input name="query" autoComplete="off" type="search" maxLength={100} className={dashboardInput} value={draft.query} onChange={(event) => change("query", event.target.value)} placeholder="Nome ou matrícula…" /></label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2"><button type="submit" disabled={loading} className={cn(dashboardButton, "border-blue-700 bg-blue-700 text-white hover:bg-blue-800")}>{loading ? "Consultando…" : "Aplicar filtros"}</button><button type="button" disabled={loading} className={dashboardButton} onClick={() => { const filters = defaultDashboardFilters(domain, today); setDraft(filters); void load(filters); }}>Limpar filtros</button><p className="text-xs text-slate-600 sm:ml-2">{period ? `Período máximo: ${domain === "chamada-diaria" ? 31 : 367} dias.` : domain === "banco-de-horas" ? "Medições disponíveis até a data de referência." : "A composição histórica do quadro não é inferida."}</p></div>
    </form>

    {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><p>{error}</p>{snapshot ? <p className="mt-1">Os indicadores abaixo continuam mostrando a última consulta concluída.</p> : null}<button type="button" disabled={loading} className={`${dashboardButton} mt-3`} onClick={() => void load(draft)}>Tentar novamente</button></div> : null}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p role="status" aria-live="polite" className="text-xs leading-relaxed text-slate-600">{loading ? "Atualizando consulta. Os dados anteriores permanecem visíveis até a conclusão." : snapshot ? `Consulta: ${periodLabel} · Atualizado em ${dashboardInstant(snapshot.queriedAt)} · America/Sao_Paulo` : "Aguardando uma consulta concluída."}</p><div className="flex shrink-0 flex-wrap gap-2"><button type="button" className={dashboardButton} disabled={loading} onClick={() => void load(applied)}><RefreshCw aria-hidden="true" size={16} />Atualizar</button><button type="button" className={dashboardButton} disabled={!snapshot || loading || exporting} onClick={() => void exportCsv()}><Download aria-hidden="true" size={16} />{exporting ? "Exportando…" : "Exportar CSV"}</button></div></div>
    {exportError ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{exportError}</p> : null}

    {snapshot ? <div aria-busy={loading} className="space-y-5">
      <section aria-label={`Indicadores de ${definition.title}`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{snapshot.metrics.map((metric) => <article key={metric.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="text-sm font-medium text-slate-600">{metric.label}</h2><p className={`mt-3 break-words font-bold tracking-tight tabular-nums ${metric.value === null ? "text-xl text-slate-500" : "text-2xl text-slate-950"}`}>{dashboardValue(metric.value, metric.format)}</p><p className="mt-2 text-xs leading-relaxed text-slate-600">{metric.description}</p>{metric.denominator !== undefined ? <p className="mt-2 text-xs font-medium text-slate-700">Base: {metric.numerator == null ? "—" : dashboardValue(metric.numerator)} / {metric.denominator === null ? "não apurável" : dashboardValue(metric.denominator)}</p> : null}</article>)}</section>
      {snapshot.notes.length ? <section aria-label="Critérios de leitura" className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950"><h2 className="font-semibold">Como ler este painel</h2><ul className="mt-2 list-disc space-y-1.5 pl-5">{snapshot.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></section> : null}
      {snapshot.charts.length ? <div className="grid items-start gap-4 xl:grid-cols-2">{snapshot.charts.map((chart) => <DashboardChart key={`${chart.id}-${revision}`} chart={chart} />)}</div> : null}
      <DashboardTable key={revision} table={snapshot.table} />
    </div> : !loading && !error ? <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">Nenhum painel disponível. Aplique os filtros para consultar os dados.</p> : null}
  </div>;
}
