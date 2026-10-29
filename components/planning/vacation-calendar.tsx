"use client";

import Link from "@/components/navigation-link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { dashboardButton, dashboardDate, dashboardInput } from "@/components/dashboards/format";
import { adjacentMonth, loadVacationCalendar, monthDays, vacationCalendarSummary, vacationStatusLabels, type VacationCalendarFilters, type VacationCalendarSnapshot } from "./vacation-calendar-data";

const badge = { draft: "border-slate-200 bg-slate-50 text-slate-700", requested: "border-amber-200 bg-amber-50 text-amber-900", approved: "border-emerald-200 bg-emerald-50 text-emerald-900", cancelled: "border-rose-200 bg-rose-50 text-rose-900" };
const label = "text-sm font-medium text-slate-700";
const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function VacationCalendar({ today }: { today: string }) {
  const [filters, setFilters] = useState<VacationCalendarFilters>({ month: today.slice(0, 7), managerId: "", unitId: "", status: "planned", query: "" });
  const [selectedDay, setSelectedDay] = useState(today);
  const [snapshot, setSnapshot] = useState<VacationCalendarSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState("");
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const runQuery = useCallback(async (controller: AbortController, version: number) => {
    try {
      const complete = await loadVacationCalendar(controller.signal);
      if (version !== sequence.current || controller.signal.aborted) return;
      setSnapshot(complete); setLoadedAt(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date()));
    } catch (failure) {
      if (version === sequence.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível carregar o calendário.");
    } finally { if (version === sequence.current && !controller.signal.aborted) setLoading(false); }
  }, []);
  const refresh = useCallback(() => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(""); void runQuery(controller, ++sequence.current);
  }, [runQuery]);
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    void runQuery(controller, ++sequence.current);
    return () => controller.abort();
  }, [runQuery]);
  const view = useMemo(() => snapshot ? vacationCalendarSummary(snapshot, filters) : null, [snapshot, filters]);
  const selected = view?.days.find(day => day.date === selectedDay) ?? view?.days[0];
  const monthTitle = monthDays(filters.month).length ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${filters.month}-01T12:00:00Z`)) : "Mês inválido";
  function changeMonth(month: string) { if (monthDays(month).length) { setFilters(previous => ({ ...previous, month })); setSelectedDay(`${month}-01`); } }
  const managerName = (id: string | null) => id ? snapshot?.options.managers.find(manager => manager.id === id)?.name ?? "Gestor não informado" : "Sem vínculo de gestor";

  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Planejamento</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Férias por Gestor e Mês</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Programações cadastradas, pessoas em férias aprovadas e solicitações ainda em análise.</p></div>
      <Link href="/planejamento/ferias" className={dashboardButton}><CalendarDays size={17} aria-hidden="true" />Gerenciar programações</Link>
    </header>
    <section aria-label="Filtros do calendário de férias" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-5">
      <label className={label}>Mês<input name="month" autoComplete="off" type="month" value={filters.month} onChange={event => changeMonth(event.target.value)} className={dashboardInput} /></label>
      <label className={label}>Gestor<select name="managerId" value={filters.managerId} onChange={event => setFilters(previous => ({ ...previous, managerId: event.target.value }))} className={dashboardInput}><option value="">Todos do escopo</option><option value="none">Sem vínculo de gestor</option>{snapshot?.options.managers.map(manager => <option key={manager.id} value={manager.id}>{manager.name}{manager.active ? "" : " (arquivado)"}</option>)}</select></label>
      <label className={label}>Unidade<select name="unitId" value={filters.unitId} onChange={event => setFilters(previous => ({ ...previous, unitId: event.target.value }))} className={dashboardInput}><option value="">Todas do escopo</option>{snapshot?.options.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}{unit.active ? "" : " (arquivada)"}</option>)}</select></label>
      <label className={label}>Situação<select name="status" value={filters.status} onChange={event => setFilters(previous => ({ ...previous, status: event.target.value }))} className={dashboardInput}><option value="planned">Em planejamento</option><option value="">Todas, incluindo canceladas</option>{Object.entries(vacationStatusLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <label className={label}>Colaborador<input name="query" autoComplete="off" type="search" maxLength={100} value={filters.query} placeholder="Nome ou matrícula…" onChange={event => setFilters(previous => ({ ...previous, query: event.target.value }))} className={dashboardInput} /></label>
    </section>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs leading-5 text-slate-600">{loadedAt ? `Consulta completa: ${snapshot?.total} programação(ões) no escopo · ${loadedAt} · America/Sao_Paulo` : "A consulta carrega todas as páginas antes de exibir as contagens."}</p><button type="button" onClick={() => void refresh()} disabled={loading} className={dashboardButton}><RefreshCw size={16} aria-hidden="true" />{loading ? "Carregando…" : "Atualizar"}</button></div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}{snapshot ? " Os dados abaixo pertencem à última consulta concluída." : " Nenhuma contagem foi apurada."}</p>}
    {loading && <p role="status" className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">Carregando todas as programações do seu escopo…</p>}
    {view && <div aria-busy={loading} className="space-y-5">
      <section aria-label="Resumo mensal de férias" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[{ name: "Pessoas com férias aprovadas", value: view.approved, note: "Pessoas únicas em pelo menos um dia do mês." }, { name: "Pessoas com solicitação", value: view.requested, note: "Solicitações não representam aprovação." }, { name: "Pico de férias aprovadas", value: view.peak, note: "Maior número de pessoas simultâneas em um dia." }, { name: "Quadro cadastral atual", value: view.workforce, note: "Cadastros ativos no recorte; não é disponibilidade diária." }].map(metric => <article key={metric.name} className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="text-sm font-medium text-slate-600">{metric.name}</h2><p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{metric.value}</p><p className="mt-2 text-xs leading-5 text-slate-600">{metric.note}</p></article>)}
      </section>
      <p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">A visão usa programações não arquivadas e a lotação atual. Rascunhos e solicitações ficam separados de férias aprovadas. Não calcula direito adquirido, saldo de férias nem equipe disponível para trabalhar.</p>
      <section aria-label="Calendário mensal" className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
        <div className="mb-4 flex items-center justify-between gap-2"><button type="button" aria-label="Mês anterior" onClick={() => changeMonth(adjacentMonth(filters.month, -1))} className={dashboardButton}><ChevronLeft size={18} aria-hidden="true" /></button><h2 className="text-center text-lg font-bold capitalize">{monthTitle}</h2><button type="button" aria-label="Próximo mês" onClick={() => changeMonth(adjacentMonth(filters.month, 1))} className={dashboardButton}><ChevronRight size={18} aria-hidden="true" /></button></div>
        <p className="mb-3 text-xs leading-5 text-slate-600">Selecione um dia para ver as pessoas e os períodos. Contagens diárias de aprovados e solicitados usam pessoas únicas.</p>
        <div className="hidden grid-cols-7 gap-1 md:grid">{weekdays.map(day => <div key={day} className="py-2 text-center text-xs font-semibold text-slate-500">{day}</div>)}{Array.from({ length: new Date(`${filters.month}-01T12:00:00Z`).getUTCDay() }, (_, index) => <div key={`blank-${index}`} aria-hidden="true" />)}{view.days.map(day => <button type="button" key={day.date} aria-pressed={selected?.date === day.date} aria-label={`${dashboardDate(day.date)}: ${day.approved} aprovado(s), ${day.requested} solicitado(s), ${day.entries.length} programação(ões)`} onClick={() => setSelectedDay(day.date)} className={cn("min-h-28 min-w-0 rounded-lg border border-slate-200 p-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700", selected?.date === day.date ? "border-blue-700 bg-blue-50 ring-1 ring-blue-700" : "hover:bg-slate-50")}><span className={cn("inline-flex min-h-7 min-w-7 items-center justify-center rounded-full text-sm font-semibold", day.date === today && "bg-slate-900 text-white")}>{Number(day.date.slice(8))}</span><span className="mt-1 block text-xs text-emerald-900">{day.approved} aprovado(s)</span><span className="mt-1 block text-xs text-amber-900">{day.requested} solicitado(s)</span>{day.entries.some(row => row.status === "draft" || row.status === "cancelled") && <span className="mt-1 block text-xs text-slate-500">+ outros registros</span>}</button>)}</div>
        <div className="space-y-3 md:hidden"><label className={label}>Consultar dia<select name="day" value={selected?.date ?? ""} onChange={event => setSelectedDay(event.target.value)} className={dashboardInput}>{view.days.map(day => <option key={day.date} value={day.date}>{dashboardDate(day.date)} · {day.entries.length} programação(ões)</option>)}</select></label><div className="grid grid-cols-2 gap-2">{view.days.filter(day => day.entries.length > 0).map(day => <button type="button" key={day.date} onClick={() => setSelectedDay(day.date)} aria-pressed={selected?.date === day.date} className={cn(dashboardButton, "flex-col items-start px-3 text-left", selected?.date === day.date && "border-blue-700 bg-blue-50 text-blue-900")}><span>{dashboardDate(day.date)}</span><span className="text-xs font-normal">{day.approved} aprovado(s)<br />{day.requested} solicitado(s)</span></button>)}</div>{!view.rows.length && <p className="py-3 text-sm text-slate-500">Nenhuma programação neste mês e recorte.</p>}</div>
      </section>
      <section aria-label="Programações do dia selecionado" className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="text-lg font-semibold">{selected ? dashboardDate(selected.date) : "Dia selecionado"}</h2><p className="mt-1 text-sm text-slate-600">{selected?.entries.length ?? 0} programação(ões) no dia selecionado.</p>{selected?.entries.length ? <ul className="mt-4 divide-y divide-slate-200">{selected.entries.map(row => <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{row.employeeName}</h3><p className="mt-1 text-xs leading-5 text-slate-600">Matrícula {row.employeeNumber} · {managerName(row.managerId)}</p><p className="mt-1 text-sm text-slate-700">{dashboardDate(row.startDate)} a {dashboardDate(row.endDate)}</p>{row.observation && <p className="mt-2 max-w-3xl whitespace-pre-wrap break-words text-sm text-slate-600">{row.observation}</p>}</div><span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", badge[row.status])}>{vacationStatusLabels[row.status]}</span></li>)}</ul> : <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Nenhuma programação no dia e nos filtros escolhidos.</p>}</section>
    </div>}
  </div>;
}
