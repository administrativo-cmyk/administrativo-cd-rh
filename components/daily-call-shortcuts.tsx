"use client";

import { useMemo } from "react";
import { Search } from "lucide-react";
import { SearchFilter } from "./monitoring/search-filter";
import type { DailyCallFilters, Employee } from "@/lib/daily-call-types";
import { payrollPeriodOptions } from "@/lib/payroll-period";
import { filterEmployees } from "@/lib/daily-call-selectors";

type Props = {
  viewMode: "today" | "period";
  selectedDate: string;
  filters: DailyCallFilters;
  payrollPeriods: string[];
  employees: Employee[];
  managerOptions: string[];
  hideManagerFilter: boolean;
  changeDate: (date: string) => void;
  changePayrollPeriod: (month: string) => void;
  updateFilter: <K extends keyof DailyCallFilters>(key: K, value: DailyCallFilters[K]) => void;
};
const controlClass = "min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

export function DailyCallShortcuts({ viewMode, selectedDate, filters, payrollPeriods, employees, managerOptions, hideManagerFilter, changeDate, changePayrollPeriod, updateFilter }: Props) {
  const periods = payrollPeriodOptions(payrollPeriods);
  const selectedPeriod = periods.some(period => period.key === filters.endDate.slice(0, 7)) ? filters.endDate.slice(0, 7) : "";
  const managers = useMemo(() => managerOptions.map(manager => ({ value: manager, label: manager })), [managerOptions]);
  const { unit, manager, situation, startDate, endDate } = filters;
  const collaborators = useMemo(() => filterEmployees(employees, { unit, manager, situation, startDate, endDate, query: "", bank: "Todos", status: "Todos" }, selectedDate)
    .map(employee => ({ value: employee.id, label: `${employee.name} · ${[employee.id, ...(employee.additionalEmployeeNumbers ?? [])].join(" / ")}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")), [employees, unit, manager, situation, startDate, endDate, selectedDate]);

  return <div aria-label="Atalhos dos filtros da chamada" className="grid min-w-0 grid-cols-1 gap-3 border-b border-slate-200 px-3 pb-3 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-end">
    {viewMode === "period" ? <label className="min-w-0 space-y-1 xl:w-44"><span className="block text-xs font-semibold text-slate-600">Período</span><select aria-label="Período rápido da chamada" value={selectedPeriod} onChange={event => changePayrollPeriod(event.target.value)} className={controlClass}>
      {!selectedPeriod ? <option value="" disabled>Selecione um período</option> : null}
      {periods.map(period => <option key={period.key} value={period.key}>{period.label}</option>)}
    </select></label> : <label className="min-w-0 space-y-1 xl:w-44"><span className="block text-xs font-semibold text-slate-600">Data</span><input aria-label="Data rápida da chamada" type="date" value={selectedDate} onChange={event => changeDate(event.target.value)} className={controlClass} /></label>}
    <label className="min-w-0 space-y-1 xl:min-w-56 xl:flex-1"><span className="block text-xs font-semibold text-slate-600">Pesquisar colaborador</span><span className="relative block"><Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-slate-500" /><input type="search" aria-label="Pesquisar colaborador por nome ou matrícula" placeholder="Nome ou matrícula" value={filters.query} onChange={event => updateFilter("query", event.target.value)} className={`${controlClass} pl-9`} /></span></label>
    {!hideManagerFilter ? <div className="min-w-0 xl:w-52"><SearchFilter label="Gestor rápido" placeholder="Pesquisar gestor" allLabel="Todos os gestores" value={filters.manager === "Todos" ? "" : filters.manager} options={managers} onChange={value => { updateFilter("manager", value || "Todos"); updateFilter("employeeId", undefined); }} /></div> : null}
    <div className="min-w-0 xl:w-72"><SearchFilter label="Colaborador rápido" placeholder="Pesquisar na lista por nome ou matrícula" allLabel="Todos os colaboradores" value={filters.employeeId ?? ""} options={collaborators} onChange={value => updateFilter("employeeId", value || undefined)} /></div>
  </div>;
}
