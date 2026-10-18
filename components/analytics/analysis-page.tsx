import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { analysisCatalog, parseAnalysisFilters, type AnalysisKind, type AnalysisSnapshot } from "@/lib/analytics/contracts";
import { loadAnalysis } from "@/lib/analytics/server";
import { DashboardChart } from "@/components/dashboards/dashboard-chart";
import { DashboardTable } from "@/components/dashboards/dashboard-table";
import { dashboardButton, dashboardDate, dashboardInstant, dashboardValue } from "@/components/dashboards/format";
import { AnalysisExport, AnalysisFiltersForm } from "./analysis-filters";
import { AnalysisNav } from "./analysis-nav";

export async function AnalysisPage({ kind, searchParams }: { kind: AnalysisKind; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireApprovedProfile();
  const today = todayInSaoPaulo();
  const definition = analysisCatalog.find((item) => item.key === kind)!;
  const query = await searchParams ?? {};
  const input = Object.fromEntries(["start", "end", "unit", "managerId", "query"].filter((key) => query[key] !== undefined).map((key) => [key, query[key]]));
  let filters = parseAnalysisFilters(kind, {}, today);
  let error = ""; let snapshot: AnalysisSnapshot | null = null;
  try { filters = parseAnalysisFilters(kind, input, today); }
  catch { error = "Os filtros do endereço são inválidos. Revise a data e aplique uma nova consulta."; }
  if (!error) {
    try { snapshot = await loadAnalysis(kind, filters); }
    catch { error = "Não foi possível carregar esta análise. Tente aplicar os filtros novamente."; }
  }
  const revision = JSON.stringify(filters);
  const activeLabel = { "top-20-banco-horas": "Top 20", "top-por-gestor": "Top por Gestor", "afastados-e-outros": "Afastados e Outros" }[kind];
  return <AppShell profile={profile} title={definition.title} activeLabel={activeLabel}>
    <div className="mx-auto min-w-0 max-w-[1600px] space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="max-w-3xl"><Link href="/analises" className="inline-flex min-h-11 items-center text-xs font-bold uppercase tracking-widest text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-blue-700">Análises</Link><h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{definition.title}</h1><p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">{definition.description}</p></div><Link href={kind === "afastados-e-outros" ? "/quadro-atual" : "/banco-de-horas"} className={dashboardButton}>Abrir {kind === "afastados-e-outros" ? "Quadro Atual" : "Banco de Horas"}</Link></header>
      <AnalysisNav selected={kind} />
      <AnalysisFiltersForm key={revision} kind={kind} filters={filters} options={snapshot?.options ?? { units: [], managers: [] }} today={today} />
      {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p> : null}
      {snapshot ? <>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-relaxed text-slate-600">Referência: {dashboardDate(snapshot.end)} · Consultado em {dashboardInstant(snapshot.queriedAt)} · America/Sao_Paulo</p><AnalysisExport key={revision} kind={kind} filters={filters} /></div>
        <section aria-label="Indicadores do recorte completo" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{snapshot.metrics.map((metric) => <article key={metric.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-sm font-medium text-slate-600">{metric.label}</h2><p className="mt-3 break-words text-2xl font-bold tracking-tight text-slate-950 tabular-nums">{dashboardValue(metric.value, metric.format)}</p><p className="mt-2 text-xs leading-relaxed text-slate-600">{metric.description}</p>{metric.denominator !== undefined ? <p className="mt-2 text-xs font-medium text-slate-700">Base: {dashboardValue(metric.numerator ?? null)} / {dashboardValue(metric.denominator)}</p> : null}</article>)}</section>
        <section aria-label="Critérios da análise" className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950"><h2 className="font-semibold">Como ler esta análise</h2><ul className="mt-2 list-disc space-y-1.5 pl-5">{snapshot.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></section>
        <div className="grid items-start gap-4 xl:grid-cols-2">{snapshot.charts.map((chart) => <DashboardChart key={`${revision}-${chart.id}`} chart={chart} />)}</div>
        <DashboardTable key={revision} table={snapshot.table} />
      </> : null}
    </div>
  </AppShell>;
}
