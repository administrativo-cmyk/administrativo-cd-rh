"use client";

import { EmployeeAvatar } from "@/components/employee-avatar";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, ChevronLeft, ChevronRight, CircleHelp, RefreshCw, Search, UserRound, Users } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { WorkforceDrawer } from "@/components/workforce-drawer";
import { formatWorkforceBalance, formatWorkforceDate } from "@/lib/workforce-format";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import { defaultWorkforceFilters, situationLabels, type WorkforceEmployee, type WorkforceFilters } from "@/lib/workforce";
import { filterWorkforce, workforceFilterCount, workforceMetrics } from "@/lib/workforce-selectors";
import { cn } from "@/lib/utils";

type SortKey = "name" | "employeeNumber" | "unit" | "manager" | "situation" | "admissionDate";
const pageSize = 20;
const emptyWorkforce: WorkforceEmployee[] = [];
const controlClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

function sortValue(employee: WorkforceEmployee, key: SortKey): string {
  if (key === "situation") return situationLabels[employee.situation];
  return employee[key] ?? "";
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Users; tone: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/4%)]"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p></div><span className={cn("grid h-9 w-9 place-items-center rounded-lg", tone)}><Icon size={18} /></span></div></div>;
}

export function WorkforceApp({ profile, employees }: { profile: AuthenticatedProfile; employees: WorkforceEmployee[] | null }) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [filters, setFilters] = useState<WorkforceFilters>(defaultWorkforceFilters);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDescending, setSortDescending] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = employees?.find((employee) => employee.id === selectedId) ?? null;
  const setSelected = (employee: WorkforceEmployee | null) => setSelectedId(employee?.id ?? null);
  const isManager = profile.papel_usuario === "GESTOR";
  const scopedEmployees = employees ?? emptyWorkforce;

  const unitOptions = useMemo(() => [...new Set(scopedEmployees.map((item) => item.unit))].sort((a, b) => a.localeCompare(b, "pt-BR")), [scopedEmployees]);
  const managerOptions = useMemo(() => {
    const managers = new Map<string, string>();
    for (const item of scopedEmployees) managers.set(item.managerId ?? "__unassigned__", item.manager ?? "Sem gestor definido");
    return [...managers].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [scopedEmployees]);
  const situationOptions = useMemo(() => [...new Set(scopedEmployees.map((item) => item.situation))].sort((a, b) => situationLabels[a].localeCompare(situationLabels[b], "pt-BR")), [scopedEmployees]);

  const filtered = useMemo(() => filterWorkforce(scopedEmployees, filters), [scopedEmployees, filters]);
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const result = sortValue(a, sortKey).localeCompare(sortValue(b, sortKey), "pt-BR", { numeric: true });
    return (sortDescending ? -result : result) || a.employeeNumber.localeCompare(b.employeeNumber, "pt-BR", { numeric: true });
  }), [filtered, sortKey, sortDescending]);
  const metrics = workforceMetrics(filtered);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const visiblePage = Math.min(page, pages);
  const visible = sorted.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);

  function updateFilter<K extends keyof WorkforceFilters>(key: K, value: WorkforceFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDescending((current) => !current);
    else { setSortKey(key); setSortDescending(false); }
    setPage(1);
  }

  return <main className="min-h-screen bg-[#f5f7fa] text-slate-900">
    <AppSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} role={profile.papel_usuario} activeLabel="Quadro Atual" />
    <section className="lg:pl-18">
      <AppHeader onMobileOpen={() => setMobileOpen(true)} profile={profile} title="Quadro Atual" />
      <div className="mx-auto max-w-[1720px] space-y-4 p-3 sm:p-4 md:p-5">
        <header className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end"><div><p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Operação de pessoas</p><h1 className="text-2xl font-bold tracking-tight md:text-[28px]">Quadro Atual</h1><p className="mt-1 text-sm text-slate-500">Colaboradores cadastrados, incluindo situações fora da Chamada Diária.</p></div><div className="flex gap-2"><span className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-500">Somente leitura</span><button type="button" onClick={() => router.refresh()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800"><RefreshCw size={14} />Atualizar</button></div></header>

        {employees === null ? <section role="alert" className="rounded-xl border border-rose-200 bg-white p-8 text-center text-sm text-slate-600">Não foi possível carregar o Quadro Atual. Atualize a página para tentar novamente.</section> : <>
          <section aria-label="Filtros do quadro" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgb(15_23_42/4%)] md:grid-cols-2 xl:grid-cols-6">
            <label className="text-xs font-semibold text-slate-600 xl:col-span-2">Buscar colaborador<div className="relative mt-1.5"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input aria-label="Buscar no quadro" placeholder="Nome, matrícula, gestor ou unidade" className={cn(controlClass, "pl-9")} value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} /></div></label>
            <label className="text-xs font-semibold text-slate-600">Unidade<select aria-label="Filtrar unidade" className={cn(controlClass, "mt-1.5")} value={filters.unit} onChange={(event) => updateFilter("unit", event.target.value)}><option value="">Todas</option>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
            {!isManager ? <label className="text-xs font-semibold text-slate-600">Gestor<select aria-label="Filtrar gestor" className={cn(controlClass, "mt-1.5")} value={filters.managerId} onChange={(event) => updateFilter("managerId", event.target.value)}><option value="">Todos</option>{managerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label> : null}
            <label className="text-xs font-semibold text-slate-600">Situação<select aria-label="Filtrar situação" className={cn(controlClass, "mt-1.5")} value={filters.situation} onChange={(event) => updateFilter("situation", event.target.value)}><option value="">Todas</option>{situationOptions.map((situation) => <option key={situation} value={situation}>{situationLabels[situation]}</option>)}</select></label>
            <div className="flex items-end"><button type="button" disabled={workforceFilterCount(filters) === 0} onClick={() => { setFilters(defaultWorkforceFilters); setPage(1); }} className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 disabled:text-slate-400 disabled:hover:bg-white">Limpar filtros{workforceFilterCount(filters) ? ` (${workforceFilterCount(filters)})` : ""}</button></div>
          </section>

          <section aria-label="Indicadores do quadro" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="No quadro" value={metrics.total} icon={Users} tone="bg-blue-50 text-blue-700" /><Metric label="Operacionais" value={metrics.operational} icon={BriefcaseBusiness} tone="bg-emerald-50 text-emerald-700" /><Metric label="Sem gestor" value={metrics.withoutManager} icon={UserRound} tone="bg-amber-50 text-amber-700" /><Metric label="Sem extrato" value={metrics.withoutExtract} icon={CircleHelp} tone="bg-slate-100 text-slate-600" /></section>

          <section aria-label="Tabela do Quadro Atual" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/4%)]"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4"><div><h2 className="text-sm font-bold">Colaboradores</h2><p className="text-xs text-slate-500">{sorted.length} de {scopedEmployees.length} no escopo</p></div><span className="text-xs text-slate-500">Página {visiblePage} de {pages}</span></div>
            {sorted.length ? <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{([ ["employeeNumber", "Matrícula"], ["name", "Colaborador"], ["unit", "Unidade"], ["manager", "Gestor"], ["situation", "Situação"], ["admissionDate", "Admissão"] ] as Array<[SortKey, string]>).map(([key, label]) => <th key={key} scope="col" aria-sort={sortKey === key ? (sortDescending ? "descending" : "ascending") : "none"} className="px-4 py-3 font-semibold"><button type="button" onClick={() => toggleSort(key)} className="text-left hover:text-blue-700">{label}{sortKey === key ? (sortDescending ? " ↓" : " ↑") : ""}</button></th>)}<th scope="col" className="px-4 py-3 font-semibold">Função</th><th scope="col" className="px-4 py-3 font-semibold">Banco de horas</th><th scope="col" className="px-4 py-3 font-semibold">Detalhes</th></tr></thead><tbody className="divide-y divide-slate-100">{visible.map((employee) => <tr key={employee.id} className="hover:bg-blue-50/40"><td className="px-4 py-3 font-mono text-slate-500">{employee.employeeNumber}</td><td className="px-4 py-3 font-semibold text-slate-900"><span className="flex items-center gap-2"><EmployeeAvatar name={employee.name} employeeId={employee.id} size={32} />{employee.name}</span></td><td className="px-4 py-3">{employee.unit}</td><td className="px-4 py-3">{employee.manager ?? "Sem gestor definido"}</td><td className="px-4 py-3"><span className="inline-flex rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">{situationLabels[employee.situation]}</span></td><td className="px-4 py-3">{formatWorkforceDate(employee.admissionDate)}</td><td className="max-w-40 truncate px-4 py-3">{employee.role ?? "Não informada"}</td><td className="px-4 py-3">{formatWorkforceBalance(employee.bankBalanceMinutes)}</td><td className="px-4 py-3"><button type="button" aria-label={`Ver detalhes de ${employee.name}`} onClick={() => setSelected(employee)} className="font-semibold text-blue-700 hover:underline">Ver detalhes</button></td></tr>)}</tbody></table></div> : <p className="p-10 text-center text-sm text-slate-500">Nenhum colaborador encontrado neste escopo.</p>}
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 p-3 text-xs text-slate-500"><span>{sorted.length ? `${(visiblePage - 1) * pageSize + 1}–${(visiblePage - 1) * pageSize + visible.length} de ${sorted.length}` : "0 resultados"}</span><div className="flex gap-2"><button type="button" aria-label="Página anterior" disabled={visiblePage === 1} onClick={() => setPage((value) => value - 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 disabled:opacity-40"><ChevronLeft size={15} /></button><button type="button" aria-label="Próxima página" disabled={visiblePage === pages} onClick={() => setPage((value) => value + 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 disabled:opacity-40"><ChevronRight size={15} /></button></div></div>
          </section>
        </>}
      </div>
    </section>
    <WorkforceDrawer employee={selected} onClose={() => setSelected(null)} />
  </main>;
}
