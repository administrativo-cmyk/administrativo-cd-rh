import { bankSituation, statusMatches } from "./daily-call-rules";
import type { DailyCallFilters, DailyCallMetrics, Employee } from "./daily-call-types";
import { situationLabels, type WorkforceSituation } from "./workforce";
import { payrollPeriodForDate } from "./payroll-period";

export const defaultDailyCallFilters: DailyCallFilters = { unit: "Todas", manager: "Todos", query: "", bank: "Todos", status: "Todos", startDate: "2026-08-21", endDate: "2026-09-20" };

export function filtersForDate(date: string): DailyCallFilters {
  const period = payrollPeriodForDate(date);
  return { ...defaultDailyCallFilters, startDate: period.startDate, endDate: period.endDate };
}

export function filterEmployees(employees: Employee[], filters: DailyCallFilters, today: string): Employee[] {
  const query = searchKey(filters.query);
  const managerRows = filters.manager === "Todos" ? new Map<string, string>() : identifyManagerRows(employees);
  return employees.filter((employee) => (filters.unit === "Todas" || employee.unit === filters.unit)
    && (filters.manager === "Todos" || employee.manager === filters.manager || (managerRows.get(employee.id) === filters.manager && hasPunchInPeriod(employee, filters.startDate, filters.endDate)))
    && (!filters.employeeId || employee.id === filters.employeeId)
    && (!query || [employee.name, employee.id, ...(employee.additionalEmployeeNumbers ?? [])].some(value => searchKey(value).includes(query)))
    && (filters.bank === "Todos" || bankSituation(employee) === filters.bank)
    && (!filters.situation || employee.situation === situationLabels[filters.situation as WorkforceSituation])
    && statusMatches(employee.attendance[today], filters.status));
}

export function calculateDailyCallMetrics(employees: Employee[], today: string): DailyCallMetrics {
  return employees.reduce<DailyCallMetrics>((metrics, employee) => {
    const code = employee.attendance[today];
    const situation = bankSituation(employee);
    metrics.collaborators += 1;
    if (code === "P") metrics.present += 1;
    if (code === "F") metrics.daysOff += 1;
    if (["A", "I", "X", "AF"].includes(code)) metrics.absences += 1;
    if (situation === "A compensar") metrics.compensate += 1;
    if (situation === "A repor") metrics.replace += 1;
    return metrics;
  }, { collaborators: 0, present: 0, daysOff: 0, absences: 0, compensate: 0, replace: 0 });
}

const searchKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");

function hasPunchInPeriod(employee: Employee, startDate?: string, endDate?: string) {
  return Object.entries(employee.attendance).some(([date, status]) => status === "P"
    && (!startDate || date >= startDate) && (!endDate || date <= endDate)
    && (!employee.attendanceSources?.[date] || employee.attendanceSources[date] === "punch"));
}

/** Only unique register matches can move a manager's attendance row. Never guess between namesakes. */
function identifyManagerRows(employees: Employee[]): Map<string, string> {
  const managers = [...new Set(employees.map(employee => employee.manager))].filter(manager => manager !== "Sem gestor definido");
  const matches = new Map<string, string[]>();
  for (const manager of managers) {
    const name = searchKey(manager);
    const exact = employees.filter(employee => searchKey(employee.name) === name);
    const alias = name.replace(/\s+(?:t\s*\d+|flv)$/, "");
    const candidates = exact.length ? exact : employees.filter(employee =>
      /\b(?:lider|supervisora?|coordenadora?|gerente|gestora?|encarregad[oa])\b/.test(searchKey(employee.role))
      && (` ${searchKey(employee.name)} `).includes(` ${alias} `));
    if (candidates.length === 1) {
      const id = candidates[0].id;
      matches.set(id, [...(matches.get(id) ?? []), manager]);
    }
  }
  return new Map([...matches].filter(([, names]) => names.length === 1).map(([id, names]) => [id, names[0]]));
}

export function groupEmployeesByManager(employees: Employee[], startDate?: string, endDate?: string, sourceEmployees = employees): Array<[string, Employee[]]> {
  const managerRows = identifyManagerRows(sourceEmployees);
  const groups = new Map<string, Employee[]>();
  for (const employee of employees) {
    const manager = (hasPunchInPeriod(employee, startDate, endDate) ? managerRows.get(employee.id) : undefined) ?? employee.manager;
    const group = groups.get(manager) ?? [];
    group.push(employee);
    groups.set(manager, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([manager, rows]) => [manager, rows.sort((a, b) =>
    Number(managerRows.get(b.id) === manager) - Number(managerRows.get(a.id) === manager) || a.name.localeCompare(b.name, "pt-BR"))]);
}

export function countActiveFilters(filters: DailyCallFilters, defaults = defaultDailyCallFilters): number {
  return Number(filters.unit !== defaultDailyCallFilters.unit) + Number(filters.manager !== defaultDailyCallFilters.manager)
    + Number(Boolean(filters.query.trim())) + Number(Boolean(filters.employeeId)) + Number(filters.bank !== defaultDailyCallFilters.bank)
    + Number(filters.status !== defaultDailyCallFilters.status)
    + Number(Boolean(filters.situation))
    + Number(filters.startDate !== defaults.startDate || filters.endDate !== defaults.endDate);
}
