import { describe, expect, it } from "vitest";
import { sortTimeBank } from "@/lib/time-bank-selectors";
import { groupEmployeesByManager } from "@/lib/daily-call-selectors";
import type { TimeBankEmployee } from "@/lib/time-bank";
import type { Employee } from "@/lib/daily-call-types";

// Deterministic synthetic data; no employee data or network access.
const employees: Employee[] = Array.from({ length: 3000 }, (_, index) => ({
  id: String(index), name: `Pessoa Sintética ${index * 7919 % 3000}`,
  unit: "CD I", manager: `Pessoa Sintética ${index % 60}`, department: "Operação",
  role: index < 60 ? "Líder" : "Auxiliar", situation: "Ativo", admissionDate: "2025-01-01",
  plannedVacation: "—", bankDays: null, bankHours: null,
  attendance: { "2026-10-28": "P" }, observations: {},
}));
const bankRows = employees.map(employee => ({
  ...employee, employeeNumber: employee.id, measuredMinutes: null,
})) as unknown as TimeBankEmployee[];

describe.runIf(process.env.CLIENT_PERFORMANCE === "1")("UI com 3.000 colaboradores", () => {
  it("mede ordenação e agrupamento sem perder colaboradores", () => {
    const measurements: Record<string, number[]> = { sort: [], group: [] };
    for (let iteration = 0; iteration < 7; iteration++) {
      let start = performance.now();
      const sorted = sortTimeBank(bankRows, "name");
      measurements.sort.push(performance.now() - start);
      expect(sorted).toHaveLength(bankRows.length);
      expect(sorted[0].name).toBe("Pessoa Sintética 0");
      expect(sorted.at(-1)?.name).toBe("Pessoa Sintética 2999");
      start = performance.now();
      const groups = groupEmployeesByManager(employees, "2026-10-21", "2026-11-20");
      measurements.group.push(performance.now() - start);
      expect(groups.flatMap(([, rows]) => rows)).toHaveLength(employees.length);
    }
    console.info("CLIENT_PERFORMANCE_MEDIAN_MS", Object.fromEntries(Object.entries(measurements)
      .map(([key, values]) => [key, Number(values.sort((a, b) => a - b)[3].toFixed(2))])));
  }, 30_000);
});
