"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { MonitoringResults } from "./monitoring-results";
import type { MonitoringSortKey } from "@/lib/monitoring/query-view";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import { filtersSchema, snapshotSchema, type MonitoringFilters, type MonitoringSnapshot } from "@/lib/monitoring/contracts";
import { cn } from "@/lib/utils";
import { MonitoringDetail } from "./monitoring-detail";
import { MonitoringAdmin } from "./monitoring-admin";
import { MonitoringProcessingProgress } from "./processing-progress";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { SearchFilter } from "./search-filter";
import { GroupFilter } from "./group-filter";
import { buttonClass, calendarDate, duration, Field, inputClass, instant, primaryClass, qualityLabels, requestJson } from "./shared";

type Tab = "query" | "import" | "reconcile" | "settings";
function params(filters: MonitoringFilters) { return new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)])).toString(); }

export function MonitoringApp({ profile, initialFilters, initialSnapshot, initialError, initialTab = "query" }: { profile: AuthenticatedProfile; initialFilters: MonitoringFilters; initialSnapshot: MonitoringSnapshot | null; initialError?: string; initialTab?: Tab }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [filters, setFilters] = useState(initialFilters);
  const [applied, setApplied] = useState(initialFilters);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(initialSnapshot ? "" : initialError ?? "Não foi possível carregar o Monitoramento. Tente atualizar.");
  const [selectedKey, setSelectedKey] = useState<{ employeeId: string; date: string | null } | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const canAdmin = profile.papel_usuario === "ADMIN" || profile.papel_usuario === "RH";
  const selected = snapshot?.rows.find((row) => row.employeeId === selectedKey?.employeeId && row.date === selectedKey.date) ?? null;
  useEffect(() => () => activeRequest.current?.abort(), []);
  function update<K extends keyof MonitoringFilters>(key: K, value: MonitoringFilters[K]) { setFilters((current) => ({ ...current, [key]: value, offset: 0 })); }
  async function load(next: MonitoringFilters) {
    const parsed = filtersSchema.safeParse(next);
    if (!parsed.success) { setError("Revise as datas: início até fim, no máximo 367 dias."); return; }
    activeRequest.current?.abort();
    const controller = new AbortController(); activeRequest.current = controller;
    setLoading(true); setError("");
    try {
      const nextSnapshot = snapshotSchema.parse(await requestJson(`/api/monitoring?${params(next)}`, { signal: controller.signal }));
      if (!controller.signal.aborted) { setSnapshot(nextSnapshot); setApplied(next); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha na consulta."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  const total = snapshot?.total ?? 0;
  const totals = snapshot?.totals ?? {};
  function sort(key: MonitoringSortKey) { const direction=(applied.orderBy??"name")===key && (applied.direction??"asc")==="asc"?"desc":"asc";setFilters(current=>({...current,orderBy:key,direction,offset:0}));void load({ ...applied, orderBy:key, direction, offset:0 }); }
  const unitOptions = snapshot?.options?.units ?? [...new Set(snapshot?.rows.map((row) => row.unit))];
  const managerOptions = snapshot?.options?.managers ?? [...new Map(snapshot?.rows.filter((row) => row.managerId).map((row) => [row.managerId!, row.manager])).entries()].map(([id, name]) => ({ id, name: name ?? "Sem gestor" }));
  const employeeOptions = useMemo(() => [...new Map([initialSnapshot, snapshot].flatMap(data =>
    (data?.options?.employees ?? data?.rows ?? []).map(employee => {
      const id = "id" in employee ? employee.id : employee.employeeId;
      return [id, { value: id, label: `${employee.name} · ${employee.employeeNumber}` }] as const;
    }))).values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR")), [initialSnapshot, snapshot]);
  const scheduleOptions = useMemo(() => [...new Set([initialSnapshot, snapshot].flatMap(data =>
    data?.options?.schedules ?? data?.rows.flatMap(row => typeof row.summary?.scheduleName === "string" && row.summary.scheduleName ? [row.summary.scheduleName] : []) ?? []))]
    .sort((a, b) => a.localeCompare(b, "pt-BR")).map(name => ({ value: name, label: name })), [initialSnapshot, snapshot]);
  async function exportRecords() {
    if (exporting) return;
    setExporting(true); setError("");
    try {
      const response = await fetch(`/api/monitoring/export?${params(applied)}`, { cache: "no-store" });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || "Não foi possível exportar."); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "monitoramento.csv"; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao exportar."); }
    finally { setExporting(false); }
  }
  function selectMonth(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const [year, number] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const today = todayInSaoPaulo();
    setFilters((current) => ({ ...current, start: `${month}-01`, end: month === today.slice(0, 7) ? today : `${month}-${String(lastDay).padStart(2, "0")}`, offset: 0 }));
  }
  return <main className="min-h-screen bg-[#f5f7fa] text-slate-900">
    <AppSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} role={profile.papel_usuario} activeLabel="Monitoramento" />
    <section className="lg:pl-18">
      <AppHeader onMobileOpen={() => setMobileOpen(true)} profile={profile} title="Monitoramento do CD" />
      <div className="mx-auto max-w-[1720px] space-y-4 p-3 sm:p-5">
        <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Operação de pessoas</p><h1 className="mt-1 text-2xl font-bold">Monitoramento do CD</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">Ponto, acessos e tempo na operação. Descanso oficial fora dos indicadores de trabalho.</p></div><button className={buttonClass} disabled={loading} onClick={() => void load(applied)}><RefreshCw size={16} />Atualizar consulta</button></header>
        <nav aria-label="Seções do Monitoramento" className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2">{([["query", "Consulta"], ...(canAdmin ? [["import", "Importação"], ["reconcile", "Conciliação"], ["settings", "Configuração"]] : [])] as [Tab, string][]).map(([value, label]) => <button key={value} aria-current={tab === value ? "page" : undefined} onClick={() => setTab(value)} className={cn(buttonClass, "shrink-0", tab === value && "border-blue-300 bg-blue-50 text-blue-800")}>{label}</button>)}</nav>
        <MonitoringProcessingProgress filters={applied} snapshotVersion={snapshot?.datasetVersion} onRefresh={()=>{if(!loading)void load(applied);}} />
        {tab !== "query" && canAdmin ? <MonitoringAdmin section={tab} today={initialFilters.end} /> : <>
          <form onSubmit={(event) => { event.preventDefault(); void load({ ...filters, offset: 0 }); }} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Filtros do Monitoramento">
            <div className="sm:col-span-2 xl:col-span-4"><Field label="Preencher período por mês"><input type="month" value={filters.start.slice(0, 7) === filters.end.slice(0, 7) ? filters.start.slice(0, 7) : ""} className={`${inputClass} sm:max-w-64`} onChange={(event) => selectMonth(event.target.value)} /></Field></div>
            <Field label="De"><input aria-label="Data inicial" type="date" required className={inputClass} value={filters.start} onChange={(event) => update("start", event.target.value)} /></Field>
            <Field label="Até"><input aria-label="Data final" type="date" required className={inputClass} value={filters.end} onChange={(event) => update("end", event.target.value)} /></Field>
            <SearchFilter label="Colaborador" placeholder="Pesquisar por nome ou matrícula…" allLabel="Todos os colaboradores" value={filters.employeeId} options={employeeOptions} onChange={employeeId => setFilters(current => ({ ...current, employeeId, query: "", offset: 0 }))} />
            <Field label="Unidade"><select className={inputClass} value={filters.unit} onChange={(event) => update("unit", event.target.value)}><option value="">Todas</option>{unitOptions.map((unit) => <option key={unit}>{unit}</option>)}</select></Field>
            {(profile.papel_usuario !== "GESTOR" || profile.visualizar_todos_gestores) ? <Field label="Gestor"><select className={inputClass} value={filters.managerId} onChange={(event) => update("managerId", event.target.value)}><option value="">Todos do escopo</option>{managerOptions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</select></Field> : null}
            <GroupFilter value={filters.group} onChange={group => update("group", group)} />
            <SearchFilter label="Escala" placeholder="Pesquisar escala…" allLabel="Todas as escalas" value={filters.schedule} options={scheduleOptions} onChange={schedule => update("schedule", schedule)} />
            <Field label="Qualidade"><select className={inputClass} value={filters.quality} onChange={(event) => update("quality", event.target.value as MonitoringFilters["quality"])}><option value="">Todas</option>{Object.entries(qualityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-4"><button className={primaryClass} disabled={loading}><Search size={16} />Aplicar filtros</button><button type="button" className={buttonClass} onClick={() => setFilters(initialFilters)}>Limpar campos</button><a className={cn(buttonClass, "sm:ml-auto")} href={`/api/monitoring/export?${params(applied)}`} download aria-disabled={exporting} onClick={(event) => { event.preventDefault(); void exportRecords(); }}><Download size={16} />{exporting ? "Exportando…" : "Exportar consulta CSV"}</a></div>
          </form>
          <div role="status" aria-live="polite" className="text-xs text-slate-600">{loading ? "Atualizando consulta…" : snapshot ? `Última consulta: ${instant(snapshot.queriedAt)} · Período: ${calendarDate(snapshot.start)} a ${calendarDate(snapshot.end)} · America/Sao_Paulo` : "Sem consulta concluída"}</div>
          {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}{snapshot ? " Os dados abaixo pertencem à última consulta concluída." : ""}</p> : null}
          {snapshot ? <>
            <section aria-label="Indicadores do Monitoramento" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">{[
              ["Colaboradores no escopo", snapshot.people], ["Fora da operação", duration(totals.displayedOutsideSeconds ?? totals.outsideSeconds)], ["Refeitório durante trabalho", duration(totals.displayedCafeteriaSeconds ?? totals.cafeteriaSeconds)], ["Refeições sem descanso", totals.mealsWithoutRest ?? "Não apurável"], ["Jornadas com atraso > 15 min", totals.lateJourneys ?? "Não apurável"], ["Pendências de apuração", snapshot.pending],
            ].map(([label, value]) => <div className="rounded-xl border border-slate-200 bg-white p-4" key={label}><p className="text-xs font-medium text-slate-600">{label}</p><b className="mt-2 block text-xl">{value}</b></div>)}</section>
            <p className="text-xs leading-relaxed text-slate-600">{snapshot.recordTotal ?? total} registro(s) · {totals.assessedJourneys ?? 0} jornada(s) confirmada(s) · {totals.latenessAssessedJourneys ?? 0} com atraso apurável · {snapshot.excluded} excluída(s) por regra. Trabalho confirmado: {duration(totals.workedSeconds)}.{Number(totals.observedJourneys)>0?<> Cálculo observado/sugerido: {duration(totals.observedWorkSeconds)} em {totals.observedJourneys} dia(s), identificado na tabela.</>:null} Tempos de localização incluem pares observados com cobertura parcial, identificados na tabela. Refeitório sem intervalo no ponto continua contado mesmo com sugestão. Tempo sem estado conhecido: {duration(totals.unknownSeconds)}. Ausência de cobertura não representa tempo zero.</p>
            <MonitoringResults key={`${applied.start}|${applied.end}|${applied.query}|${applied.unit}|${applied.managerId}|${applied.group}|${applied.schedule}|${applied.quality}`} snapshot={snapshot} applied={applied} loading={loading} onSort={sort} onPage={offset=>void load({...applied,offset})} onDetails={(employeeId,date)=>setSelectedKey({employeeId,date})}/>
          </> : null}
        </>}
      </div>
    </section>
    {selected ? <MonitoringDetail key={`${selected.employeeId}|${selected.date}`} employee={selected} start={applied.start} end={applied.end} canAdmin={canAdmin} onClose={() => setSelectedKey(null)} onReprocessed={() => void load(applied)} /> : null}
  </main>;
}
