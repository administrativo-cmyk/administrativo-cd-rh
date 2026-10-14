import { defaultTimeBankFilters, type TimeBankClassification, type TimeBankEmployee, type TimeBankFilters } from "@/lib/time-bank";

export type TimeBankOrder = "name" | "employeeNumber" | "mostPositive" | "mostNegative";

function searchable(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function classifyTimeBank(row: TimeBankEmployee): TimeBankClassification {
  if (row.measuredMinutes === null) return "SEM_EXTRATO";
  if (row.measuredMinutes > 0) return "POSITIVO";
  if (row.measuredMinutes < 0) return "NEGATIVO";
  return "ZERO";
}

export function timeBankStatusLabel(row: TimeBankEmployee): string {
  if (row.effectiveDays === null) return "Sem extrato";
  if (row.effectiveDays > 0) return "A compensar";
  if (row.effectiveDays < 0) return "A repor";
  return row.measuredMinutes === 0 ? "Zerado" : "Em dia após G";
}

export function filterTimeBank(rows: TimeBankEmployee[], filters: TimeBankFilters): TimeBankEmployee[] {
  const query = searchable(filters.query.trim());
  return rows.filter((row) =>
    (!filters.unit || row.unit === filters.unit)
    && (!filters.managerId || (filters.managerId === "__unassigned__"
      ? row.managerId === null : row.managerId === filters.managerId))
    && (!filters.situation || row.situation === filters.situation)
    && (!filters.classification || classifyTimeBank(row) === filters.classification)
    && (!query || [row.name, row.employeeNumber, row.manager ?? "Sem gestor definido", row.unit]
      .some((value) => searchable(value).includes(query))));
}

export function sortTimeBank(rows: TimeBankEmployee[], order: TimeBankOrder): TimeBankEmployee[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (order === "name" || order === "employeeNumber") {
      return a[order].localeCompare(b[order], "pt-BR", { numeric: true })
        || a.employeeNumber.localeCompare(b.employeeNumber, "pt-BR", { numeric: true });
    }
    const aBalance = a.measuredMinutes;
    const bBalance = b.measuredMinutes;
    if (aBalance === null) return bBalance === null ? a.name.localeCompare(b.name, "pt-BR") : 1;
    if (bBalance === null) return -1;
    return (order === "mostPositive" ? bBalance - aBalance : aBalance - bBalance)
      || a.name.localeCompare(b.name, "pt-BR");
  });
  return sorted;
}

export function timeBankMetrics(rows: TimeBankEmployee[]) {
  const result = { total: rows.length, withExtract: 0, positive: 0, zero: 0, negative: 0, withoutExtract: 0 };
  for (const row of rows) {
    const classification = classifyTimeBank(row);
    if (classification === "SEM_EXTRATO") result.withoutExtract += 1;
    else {
      result.withExtract += 1;
      if (classification === "POSITIVO") result.positive += 1;
      else if (classification === "NEGATIVO") result.negative += 1;
      else result.zero += 1;
    }
  }
  return result;
}

export function timeBankFilterCount(filters: TimeBankFilters): number {
  return (Object.keys(defaultTimeBankFilters) as Array<keyof TimeBankFilters>)
    .filter((key) => filters[key] !== defaultTimeBankFilters[key]).length;
}
