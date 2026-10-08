import { defaultWorkforceFilters, type WorkforceEmployee, type WorkforceFilters } from "@/lib/workforce";

const operationalSituations = new Set(["ATIVO", "FERIAS", "NOVO_ADMITIDO"]);

function searchable(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function isOperationalInWorkforce(employee: WorkforceEmployee): boolean {
  return employee.activeInSystem && operationalSituations.has(employee.situation);
}

export function filterWorkforce(employees: WorkforceEmployee[], filters: WorkforceFilters): WorkforceEmployee[] {
  const query = searchable(filters.query.trim());
  return employees.filter((employee) =>
    (!filters.unit || employee.unit === filters.unit)
    && (!filters.managerId || (filters.managerId === "__unassigned__"
      ? employee.managerId === null : employee.managerId === filters.managerId))
    && (!filters.situation || employee.situation === filters.situation)
    && (!query || [employee.name, employee.employeeNumber, employee.manager ?? "Sem gestor definido", employee.unit]
      .some((value) => searchable(value).includes(query))));
}

export function workforceMetrics(employees: WorkforceEmployee[]) {
  return {
    total: employees.length,
    operational: employees.filter(isOperationalInWorkforce).length,
    withoutManager: employees.filter((employee) => employee.managerId === null).length,
    withoutExtract: employees.filter((employee) => employee.bankBalanceMinutes === null).length,
  };
}

export function workforceFilterCount(filters: WorkforceFilters): number {
  return (Object.keys(defaultWorkforceFilters) as Array<keyof WorkforceFilters>)
    .filter((key) => filters[key] !== defaultWorkforceFilters[key]).length;
}
