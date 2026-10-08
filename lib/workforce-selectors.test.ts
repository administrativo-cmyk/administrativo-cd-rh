import { describe, expect, it } from "vitest";
import { filterWorkforce, isOperationalInWorkforce, workforceMetrics } from "@/lib/workforce-selectors";
import { defaultWorkforceFilters, type WorkforceEmployee } from "@/lib/workforce";

const teamA = "20000000-0000-4000-8000-000000000001";
const teamB = "20000000-0000-4000-8000-000000000002";

function employee(patch: Partial<WorkforceEmployee> = {}): WorkforceEmployee {
  return {
    id: "30000000-0000-4000-8000-000000000001", employeeNumber: "FICT-001",
    name: "Ana Fictícia", unit: "CD I", manager: "Gestora Exemplo", managerId: teamA,
    department: "Operação", role: "Auxiliar", situation: "ATIVO", category: null,
    admissionDate: "2025-01-01", workdayHours: 7.3333, activeInSystem: true,
    bankMeasurementDate: "2026-09-28", bankBalanceMinutes: 440, bankBalanceDays: 1,
    ...patch,
  };
}

const rows = [
  employee(),
  employee({ id: "30000000-0000-4000-8000-000000000002", employeeNumber: "FICT-002", name: "Bruno Fictício", unit: "CD II", situation: "AFASTADO", bankMeasurementDate: null, bankBalanceMinutes: null, bankBalanceDays: null }),
  employee({ id: "30000000-0000-4000-8000-000000000003", employeeNumber: "FICT-003", name: "Carla Fictícia", unit: "CD II", manager: "Outro Gestor", managerId: teamB, situation: "FERIAS" }),
  employee({ id: "30000000-0000-4000-8000-000000000004", employeeNumber: "FICT-004", name: "Davi Fictício", unit: "CD FLV", manager: null, managerId: null, bankMeasurementDate: null, bankBalanceMinutes: null, bankBalanceDays: null }),
];

describe("seletores do Quadro Atual", () => {
  it("inclui situação não operacional, sem gestor e sem extrato no quadro", () => {
    expect(workforceMetrics(rows)).toEqual({ total: 4, operational: 3, withoutManager: 1, withoutExtract: 2 });
    expect(isOperationalInWorkforce(rows[1])).toBe(false);
  });

  it("busca nome, matrícula, gestor e unidade sem depender de caixa ou acento", () => {
    for (const [query, expected] of [["ANA FICTICIA", "FICT-001"], ["FICT-002", "FICT-002"], ["Outro Gestor", "FICT-003"], ["CD FLV", "FICT-004"]]) {
      expect(filterWorkforce(rows, { ...defaultWorkforceFilters, query }).map((row) => row.employeeNumber)).toEqual([expected]);
    }
  });

  it("filtra unidade, gestor, situação e sem gestor em dados recebidos", () => {
    expect(filterWorkforce(rows, { ...defaultWorkforceFilters, unit: "CD II" })).toHaveLength(2);
    expect(filterWorkforce(rows, { ...defaultWorkforceFilters, managerId: teamA })).toHaveLength(2);
    expect(filterWorkforce(rows, { ...defaultWorkforceFilters, situation: "AFASTADO" })).toHaveLength(1);
    expect(filterWorkforce(rows, { ...defaultWorkforceFilters, managerId: "__unassigned__" })).toEqual([rows[3]]);
  });

  it("busca e filtros do gestor nunca ampliam o conjunto já limitado pelo backend", () => {
    const scoped = rows.filter((row) => row.managerId === teamA);
    expect(filterWorkforce(scoped, { ...defaultWorkforceFilters, query: "Carla" })).toEqual([]);
    expect(filterWorkforce(scoped, { ...defaultWorkforceFilters, unit: "CD II" })).toEqual([rows[1]]);
    expect(workforceMetrics(scoped).total).toBe(2);
  });
});
