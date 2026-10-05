import { describe, expect, it } from "vitest";
import { mapDailyCallSnapshot } from "./daily-call-snapshot";
import { filtersForDate, filterEmployees, calculateDailyCallMetrics, groupEmployeesByManager } from "@/lib/daily-call-selectors";
import { getBankHoursSummary } from "@/lib/daily-call-rules";
import { dateRange } from "@/components/period-grid";
import { todayInSaoPaulo, validPeriod } from "./daily-call-dates";

function row(index: number, balanceMinutes: number | null = 440, manager: string | null = "Gestor Fictício") {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    employeeNumber: `FICT-${index}`,
    name: `Colaborador Fictício ${index}`,
    unit: index % 3 === 0 ? "CD I" : index % 3 === 1 ? "CD II" : "CD FLV",
    department: "Operação", role: "Auxiliar", situation: "ATIVO", manager,
    admissionDate: "2025-01-01",
    measurementDate: balanceMinutes === null ? null : "2026-09-28",
    effectiveFrom: balanceMinutes === null ? null : "2026-09-28",
    workdayHours: balanceMinutes === null ? null : 7.3333,
    balanceMinutes,
    balanceDays: balanceMinutes === null ? null : balanceMinutes < 0 ? -1 : balanceMinutes === 0 ? 0 : 1,
    usedCompensationDays: 0,
    pendingCompensationDays: balanceMinutes === null ? null : balanceMinutes > 0 ? 1 : 0,
    replacementDays: balanceMinutes === null ? null : balanceMinutes < 0 ? 1 : 0,
    attendance: [],
  } as const;
}

function snapshot(rows: unknown[], date = "2026-10-05") {
  return mapDailyCallSnapshot({ date, startDate: "2026-10-01", endDate: "2026-10-31", employees: rows });
}

describe("Chamada Diária real, somente leitura", () => {
  it("reconcilia população conceitual 367/355/12 sem converter ausência em zero", () => {
    const people = Array.from({ length: 367 }, (_, index) => row(index, index < 355 ? 440 : null, index < 9 ? null : "Gestor Fictício"));
    const result = snapshot(people);
    expect(result.employees).toHaveLength(367);
    expect(result.employees.filter((person) => person.realBank)).toHaveLength(355);
    expect(result.employees.filter((person) => person.realBank === null)).toHaveLength(12);
    expect(result.employees.filter((person) => person.manager === "Sem gestor definido")).toHaveLength(9);
    expect(getBankHoursSummary(result.employees[366]).situation).toBe("Sem extrato");
    expect(result.employees[366].bankDays).toBeNull();
  });

  it("separa saldo zero verdadeiro, positivo e negativo, sem simular G", () => {
    const result = snapshot([row(1, 0), row(2, 440), row(3, -440)]);
    expect(getBankHoursSummary(result.employees[0])).toMatchObject({ situation: "Em dia", balanceHours: "00:00", balanceDays: 0 });
    expect(getBankHoursSummary(result.employees[1])).toMatchObject({ situation: "A compensar", pendingCompensationDays: 1, usedCompensationDays: 0 });
    expect(getBankHoursSummary(result.employees[2])).toMatchObject({ situation: "A repor", replacementDays: 1, usedCompensationDays: 0 });
    expect(calculateDailyCallMetrics(result.employees, result.date)).toMatchObject({ collaborators: 3, present: 0, daysOff: 0, absences: 0 });
    expect(result.employees.every((person) => Object.keys(person.attendance).length === 0)).toBe(true);
  });

  it("filtra unidade, gestor e matrícula sem vazar campos extras", () => {
    const result = snapshot([row(1, null, null), { ...row(2), cpf: "NÃO DEVOLVE" }, row(3)]);
    const filters = filtersForDate(result.date);
    expect(filterEmployees(result.employees, { ...filters, unit: "CD II" }, result.date)).toHaveLength(1);
    expect(filterEmployees(result.employees, { ...filters, manager: "Sem gestor definido" }, result.date)).toHaveLength(1);
    expect(filterEmployees(result.employees, { ...filters, query: "FICT-2" }, result.date)).toHaveLength(1);
    expect(groupEmployeesByManager(result.employees).map(([manager]) => manager)).toContain("Sem gestor definido");
    expect(JSON.stringify(result)).not.toContain("cpf");
  });

  it("valida datas reais, inclusive antes/depois da baseline e meses de 31 dias", () => {
    expect(snapshot([row(1, null)], "2026-09-27").employees[0].realBank).toBeNull();
    expect(snapshot([row(1)], "2026-10-05").employees[0].realBank?.effectiveFrom).toBe("2026-09-28");
    expect(dateRange("2026-10-01", "2026-10-31")).toHaveLength(31);
    expect(validPeriod("2026-10-01", "2026-11-01")).toBe(false);
    expect(todayInSaoPaulo(new Date("2026-10-06T02:00:00Z"))).toBe("2026-10-05");
  });
});
