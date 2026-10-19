import { bankSituation, statusMatches } from "./daily-call-rules";
import type { DailyCallFilters, DailyCallMetrics, Employee } from "./daily-call-types";
import { situationLabels, type WorkforceSituation } from "./workforce";

export const defaultDailyCallFilters: DailyCallFilters = { unit: "Todas", manager: "Todos", query: "", bank: "Todos", status: "Todos", startDate: "2026-09-01", endDate: "2026-09-30" };

export function filtersForDate(date: string): DailyCallFilters {
  const [year, month] = date.split("-").map(Number);
  const end = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { ...defaultDailyCallFilters, startDate: `${date.slice(0, 7)}-01`, endDate: `${date.slice(0, 7)}-${String(end).padStart(2, "0")}` };
}

export function filterEmployees(employees: Employee[], filters: DailyCallFilters, today: string): Employee[] {
  const query = filters.query.trim().toLocaleLowerCase("pt-BR");
  return employees.filter((employee) => (filters.unit === "Todas" || employee.unit === filters.unit)
    && (filters.manager === "Todos" || employee.manager === filters.manager)
    && (!query || employee.name.toLocaleLowerCase("pt-BR").includes(query) || employee.id.toLocaleLowerCase("pt-BR").includes(query))
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

export function groupEmployeesByManager(employees: Employee[]): Array<[string, Employee[]]> {
  const groups = new Map<string, Employee[]>();
  for (const employee of employees) groups.set(employee.manager, [...(groups.get(employee.manager) ?? []), employee]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
}

export function countActiveFilters(filters: DailyCallFilters, defaults = defaultDailyCallFilters): number {
  return Number(filters.unit !== defaultDailyCallFilters.unit) + Number(filters.manager !== defaultDailyCallFilters.manager)
    + Number(Boolean(filters.query.trim())) + Number(filters.bank !== defaultDailyCallFilters.bank)
    + Number(filters.status !== defaultDailyCallFilters.status)
    + Number(Boolean(filters.situation))
    + Number(filters.startDate !== defaults.startDate || filters.endDate !== defaults.endDate);
}
