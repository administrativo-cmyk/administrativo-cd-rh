"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleHelp, Clock3, Minus, Plus, RefreshCw, Search, Users } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { formatWorkforceDate } from "@/lib/workforce-format";
import { TimeBankDrawer, formatBankDays } from "@/components/time-bank-drawer";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import { formatSignedMinutes } from "@/lib/domain/bank-hours";
import { defaultTimeBankFilters, type TimeBankEmployee, type TimeBankFilters, type TimeBankSnapshot } from "@/lib/time-bank";
import { classifyTimeBank, filterTimeBank, sortTimeBank, timeBankFilterCount, timeBankMetrics, timeBankStatusLabel, type TimeBankOrder } from "@/lib/time-bank-selectors";
import { situationLabels } from "@/lib/workforce";
import { cn } from "@/lib/utils";

const pageSize = 20;
const controlClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100";
const classificationLabels = {
  POSITIVO: "Positivo", ZERO: "Zerado", NEGATIVO: "Negativo", SEM_EXTRATO: "Sem extrato",
};

function Metric({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Users; tone: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/4%)]"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p></div><span className={cn("grid h-9 w-9 place-items-center rounded-lg", tone)}><Icon size={18} /></span></div></div>;
}

function BalanceBadge({ employee }: { employee: TimeBankEmployee }) {
  const kind = classifyTimeBank(employee);
  const tone = kind === "POSITIVO" ? "bg-rose-50 text-rose-700"
    : kind === "NEGATIVO" ? "bg-blue-50 text-blue-700"
      : "bg-slate-100 text-slate-600";
  return <span className={cn("inline-flex rounded-full px-2 py-1 text-xs font-semibold", tone)}>{classificationLabels[kind]}</span>;
}

export function TimeBankApp({ profile, snapshot }: { profile: AuthenticatedProfile; snapshot: TimeBankSnapshot | null }) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [filters, setFilters] = useState<TimeBankFilters>(defaultTimeBankFilters);
  const [order, setOrder] = useState<TimeBankOrder>("name");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TimeBankEmployee | null>(null);
  const isManager = profile.papel_usuario === "GESTOR";
  const employees = useMemo(() => snapshot?.employees ?? [], [snapshot]);

  const unitOptions = useMemo(() => [...new Set(employees.map((row) => row.unit))].sort((a, b) => a.localeCompare(b, "pt-BR")), [employees]);
  const managerOptions = useMemo(() => {
    const managers = new Map<string, string>();
    for (const row of employees) managers.set(row.managerId ?? "__unassigned__", row.manager ?? "Sem gestor definido");
    return [...managers].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [employees]);
  const situationOptions = useMemo(() => [...new Set(employees.map((row) => row.situation))]
    .sort((a, b) => situationLabels[a].localeCompare(situationLabels[b], "pt-BR")), [employees]);
  const filtered = useMemo(() => filterTimeBank(employees, filters), [employees, filters]);
  const sorted = useMemo(() => sortTimeBank(filtered, order), [filtered, order]);
  const metrics = timeBankMetrics(filtered);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const visiblePage = Math.min(page, pages);
  const visible = sorted.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);

  function updateFilter<K extends keyof TimeBankFilters>(key: K, value: TimeBankFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  return <main className="min-h-screen bg-[#f5f7fa] text-slate-900">
    <AppSidebar collapsed={collapsed} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} role={profile.papel_usuario} activeLabel="Banco de Horas" />
    <section className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-18" : "lg:pl-[232px]")}>
      <AppHeader collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} onMobileOpen={() => setMobileOpen(true)} profile={profile} title="Banco de Horas" />
      <div className="mx-auto max-w-[1720px] space-y-4 p-3 sm:p-4 md:p-5">
        <header className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end"><div><p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Operação de pessoas</p><h1 className="text-2xl font-bold tracking-tight md:text-[28px]">Banco de Horas</h1><p className="mt-1 text-sm text-slate-500">Saldo medido e dias disponíveis do quadro cadastrado completo.</p></div><div className="flex flex-wrap gap-2"><span className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-500">Somente leitura</span>{snapshot ? <span className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-500">Consulta em {formatWorkforceDate(snapshot.asOfDate)}</span> : null}<button type="button" onClick={() => router.refresh()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800"><RefreshCw size={14} />Atualizar</button></div></header>

        {snapshot === null ? <section role="alert" className="rounded-xl border border-rose-200 bg-white p-8 text-center text-sm text-slate-600">Não foi possível carregar o Banco de Horas. Atualize a página para tentar novamente.</section> : <>
          <section aria-label="Filtros do banco de horas" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/4%)] md:grid-cols-2 xl:grid-cols-7">
            <label className="text-xs font-semibold text-slate-600 xl:col-span-2">Buscar colaborador<div className="relative mt-1.5"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input aria-label="Buscar no banco de horas" placeholder="Nome, matrícula, gestor ou unidade" className={cn(controlClass, "pl-9")} value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} /></div></label>
            <label className="text-xs font-semibold text-slate-600">Unidade<select aria-label="Filtrar unidade" className={cn(controlClass, "mt-1.5")} value={filters.unit} onChange={(event) => updateFilter("unit", event.target.value)}><option value="">Todas</option>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
            {!isManager ? <label className="text-xs font-semibold text-slate-600">Gestor<select aria-label="Filtrar gestor" className={cn(controlClass, "mt-1.5")} value={filters.managerId} onChange={(event) => updateFilter("managerId", event.target.value)}><option value="">Todos</option>{managerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label> : null}
            <label className="text-xs font-semibold text-slate-600">Situação<select aria-label="Filtrar situação" className={cn(controlClass, "mt-1.5")} value={filters.situation} onChange={(event) => updateFilter("situation", event.target.value)}><option value="">Todas</option>{situationOptions.map((situation) => <option key={situation} value={situation}>{situationLabels[situation]}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600">Saldo<select aria-label="Filtrar classificação" className={cn(controlClass, "mt-1.5")} value={filters.classification} onChange={(event) => updateFilter("classification", event.target.value)}><option value="">Todos</option>{Object.entries(classificationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <div className="flex items-end"><button type="button" disabled={timeBankFilterCount(filters) === 0} onClick={() => { setFilters(defaultTimeBankFilters); setPage(1); }} className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 disabled:text-slate-400 disabled:hover:bg-white">Limpar filtros{timeBankFilterCount(filters) ? ` (${timeBankFilterCount(filters)})` : ""}</button></div>
          </section>

          <section aria-label="Indicadores do banco de horas" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="No quadro" value={metrics.total} icon={Users} tone="bg-blue-50 text-blue-700" /><Metric label="Positivos" value={metrics.positive} icon={Plus} tone="bg-rose-50 text-rose-700" /><Metric label="Negativos" value={metrics.negative} icon={Minus} tone="bg-blue-50 text-blue-700" /><Metric label="Zerados" value={metrics.zero} icon={Clock3} tone="bg-emerald-50 text-emerald-700" /><Metric label="Sem extrato" value={metrics.withoutExtract} icon={CircleHelp} tone="bg-slate-100 text-slate-600" /></section>

          <section aria-label="Tabela do banco de horas" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/4%)]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4"><div><h2 className="text-sm font-bold">Colaboradores</h2><p className="text-xs text-slate-500">{sorted.length} de {employees.length} no escopo · {metrics.withExtract} com extrato no filtro</p></div><div className="flex items-center gap-2"><label className="text-xs text-slate-500" htmlFor="bank-order">Ordenar por</label><select id="bank-order" aria-label="Ordenar banco de horas" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs" value={order} onChange={(event) => { setOrder(event.target.value as TimeBankOrder); setPage(1); }}><option value="name">Nome</option><option value="employeeNumber">Matrícula</option><option value="mostPositive">Maior saldo positivo</option><option value="mostNegative">Maior saldo negativo</option></select></div></div>
            {sorted.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Matrícula", "Colaborador", "Unidade", "Gestor", "Situação", "Saldo medido", "Classificação", "Saldo atual", "Medição", "Detalhes"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{visible.map((employee) => <tr key={employee.id} className="hover:bg-blue-50/40"><td className="px-4 py-3 font-mono text-slate-500">{employee.employeeNumber}</td><td className="px-4 py-3 font-semibold text-slate-900">{employee.name}</td><td className="px-4 py-3">{employee.unit}</td><td className="px-4 py-3">{employee.manager ?? "Sem gestor definido"}</td><td className="px-4 py-3">{situationLabels[employee.situation]}</td><td className="px-4 py-3 font-semibold">{employee.measuredMinutes === null ? "Sem extrato" : formatSignedMinutes(employee.measuredMinutes)}</td><td className="px-4 py-3"><BalanceBadge employee={employee} /></td><td className="px-4 py-3"><b>{formatBankDays(employee.effectiveDays)}</b><span className="block text-[10px] text-slate-500">{timeBankStatusLabel(employee)}</span></td><td className="px-4 py-3">{employee.measurementDate ? formatWorkforceDate(employee.measurementDate) : "-"}</td><td className="px-4 py-3"><button type="button" aria-label={`Ver detalhes de ${employee.name}`} onClick={() => setSelected(employee)} className="font-semibold text-blue-700 hover:underline">Ver detalhes</button></td></tr>)}</tbody></table></div> : <p className="p-10 text-center text-sm text-slate-500">Nenhum colaborador encontrado neste escopo.</p>}
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 p-3 text-xs text-slate-500"><span>{sorted.length ? `${(visiblePage - 1) * pageSize + 1}-${(visiblePage - 1) * pageSize + visible.length} de ${sorted.length}` : "0 resultados"}</span><div className="flex items-center gap-2"><span>Página {visiblePage} de {pages}</span><button type="button" aria-label="Página anterior" disabled={visiblePage === 1} onClick={() => setPage((value) => value - 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 disabled:opacity-40"><ChevronLeft size={15} /></button><button type="button" aria-label="Próxima página" disabled={visiblePage === pages} onClick={() => setPage((value) => value + 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 disabled:opacity-40"><ChevronRight size={15} /></button></div></div>
          </section>
        </>}
      </div>
    </section>
    <TimeBankDrawer employee={selected} onClose={() => setSelected(null)} />
  </main>;
}
