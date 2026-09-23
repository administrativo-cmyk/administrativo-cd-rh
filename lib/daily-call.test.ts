import { describe, expect, it } from "vitest";
import { applyAttendanceStatus, getBankHoursSummary } from "./daily-call-rules";
import { calculateDailyCallMetrics, defaultDailyCallFilters, filterEmployees, groupEmployeesByManager } from "./daily-call-selectors";
import { initialEmployees, TODAY } from "./mock-daily-call";
import type { DailyCallFilters, Employee } from "./daily-call-types";

function filters(patch: Partial<DailyCallFilters>): DailyCallFilters { return { ...defaultDailyCallFilters, ...patch }; }
function bankEmployee(bankDays: number): Employee {
  return { ...initialEmployees[0], bankDays, bankHours: bankDays < 0 ? "-16:00" : bankDays > 0 ? "+16:00" : "00:00", attendance: {}, observations: {} };
}

describe("filtros da chamada", () => {
  it("filtra por unidade", () => { const result = filterEmployees(initialEmployees, filters({ unit: "CD II" }), TODAY); expect(result.length).toBeGreaterThan(0); expect(result.every((employee) => employee.unit === "CD II")).toBe(true); });
  it("busca por nome sem diferenciar maiúsculas", () => { const result = filterEmployees(initialEmployees, filters({ query: "marina duarte" }), TODAY); expect(result.map((employee) => employee.name)).toContain("Marina Duarte"); });
  it("busca por matrícula", () => { const target = initialEmployees[7]; expect(filterEmployees(initialEmployees, filters({ query: target.id }), TODAY)).toEqual([target]); });
  it("filtra por gestor", () => { const result = filterEmployees(initialEmployees, filters({ manager: "ARMANDO" }), TODAY); expect(result.length).toBeGreaterThan(0); expect(result.every((employee) => employee.manager === "ARMANDO")).toBe(true); });
});

describe("regra de compensação G", () => {
  it("reduz a pendência de saldo positivo", () => { const updated = applyAttendanceStatus(bankEmployee(2), "2026-09-01", "G"); expect(getBankHoursSummary(updated).pendingCompensationDays).toBe(1); });
  it("não reduz saldo negativo", () => { const updated = applyAttendanceStatus(bankEmployee(-2), "2026-09-01", "G"); expect(getBankHoursSummary(updated)).toMatchObject({ replacementDays: 2, pendingCompensationDays: 0, situation: "A repor" }); });
  it("leva o saldo positivo a Em dia quando a pendência zera", () => { const first = applyAttendanceStatus(bankEmployee(2), "2026-09-01", "G"); const second = applyAttendanceStatus(first, "2026-09-02", "G"); expect(getBankHoursSummary(second)).toMatchObject({ pendingCompensationDays: 0, situation: "Em dia" }); });
});

describe("seletores operacionais", () => {
  it("faz os indicadores acompanharem os filtros", () => { const visible = filterEmployees(initialEmployees, filters({ unit: "CD I" }), TODAY); const metrics = calculateDailyCallMetrics(visible, TODAY); expect(metrics.collaborators).toBe(visible.length); expect(metrics.present).toBe(visible.filter((employee) => employee.attendance[TODAY] === "P").length); expect(metrics.compensate + metrics.replace).toBeLessThanOrEqual(visible.length); });
  it("agrupa por gestor sem duplicar colaboradores", () => { const groups = groupEmployeesByManager(initialEmployees); expect(groups).toHaveLength(6); expect(groups.flatMap(([, employees]) => employees)).toHaveLength(initialEmployees.length); expect(new Set(groups.flatMap(([, employees]) => employees.map((employee) => employee.id))).size).toBe(initialEmployees.length); });
});
