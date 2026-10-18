import { describe, expect, it } from "vitest";
import { defaultTimeBankFilters, type TimeBankEmployee } from "@/lib/time-bank";
import { classifyTimeBank, filterTimeBank, sortTimeBank, timeBankMetrics, timeBankStatusLabel } from "@/lib/time-bank-selectors";

const teamA = "20000000-0000-4000-8000-000000000001";
const teamB = "20000000-0000-4000-8000-000000000002";

function employee(patch: Partial<TimeBankEmployee> = {}): TimeBankEmployee {
  return {
    id: "30000000-0000-4000-8000-000000000001", employeeNumber: "FICT-001",
    name: "Ana Fictícia", unit: "CD I", manager: "Gestora Exemplo", managerId: teamA,
    department: null, role: "Auxiliar", situation: "ATIVO", workdayHours: 7.3333,
    measurementDate: "2026-09-28", effectiveFrom: "2026-09-28",
    measuredMinutes: 600, measuredDays: 1, usedCompensationDays: 0,
    pendingCompensationDays: 1, replacementDays: 0, effectiveDays: 1,
    ...patch,
  };
}

const rows = [
  employee(),
  employee({ id: "30000000-0000-4000-8000-000000000002", employeeNumber: "FICT-002",
    name: "Bruno Fictício", unit: "CD II", manager: "Outro Gestor", managerId: teamB,
    situation: "AFASTADO", measuredMinutes: -310, measuredDays: -1,
    pendingCompensationDays: 0, replacementDays: 1, effectiveDays: -1 }),
  employee({ id: "30000000-0000-4000-8000-000000000003", employeeNumber: "FICT-003",
    name: "Carla Fictícia", unit: "CD II", measuredMinutes: 0, measuredDays: 0,
    pendingCompensationDays: 0, effectiveDays: 0 }),
  employee({ id: "30000000-0000-4000-8000-000000000004", employeeNumber: "FICT-004",
    name: "Davi Fictício", unit: "CD FLV", manager: null, managerId: null,
    measurementDate: null, effectiveFrom: null, measuredMinutes: null,
    measuredDays: null, pendingCompensationDays: null, replacementDays: null,
    effectiveDays: null }),
];

describe("seletores do Banco de Horas", () => {
  it("distingue saldo parcial, zero real e compensação aplicada", () => {
    for (const minutes of [60, -60]) {
      expect(timeBankStatusLabel(employee({ measuredMinutes: minutes, measuredDays: 0, effectiveDays: 0 }))).toBe("Saldo parcial");
    }
    expect(timeBankStatusLabel(employee({ measuredMinutes: 0, measuredDays: 0, effectiveDays: 0 }))).toBe("Zerado");
    expect(timeBankStatusLabel(employee({ measuredDays: 1, effectiveDays: 0, usedCompensationDays: 1 }))).toBe("Em dia após G");
  });
  it("separa positivo, zero, negativo e sem extrato sem perder o quadro completo", () => {
    expect(rows.map(classifyTimeBank)).toEqual(["POSITIVO", "NEGATIVO", "ZERO", "SEM_EXTRATO"]);
    expect(timeBankMetrics(rows)).toEqual({
      total: 4, withExtract: 3, positive: 1, zero: 1, negative: 1, withoutExtract: 1,
    });
    expect(timeBankStatusLabel(rows[0])).toBe("A compensar");
    expect(timeBankStatusLabel(rows[1])).toBe("A repor");
    expect(timeBankStatusLabel(rows[2])).toBe("Zerado");
    expect(timeBankStatusLabel(rows[3])).toBe("Sem extrato");
  });

  it("busca nome, matrícula, gestor e unidade com acentos neutralizados", () => {
    for (const [query, expected] of [
      ["ANA FICTICIA", "FICT-001"], ["FICT-002", "FICT-002"],
      ["Outro Gestor", "FICT-002"], ["CD FLV", "FICT-004"],
    ]) {
      expect(filterTimeBank(rows, { ...defaultTimeBankFilters, query }).map((row) => row.employeeNumber)).toEqual([expected]);
    }
  });

  it("filtra dados e métricas somente dentro do escopo recebido", () => {
    const scoped = rows.filter((row) => row.managerId === teamA);
    expect(filterTimeBank(scoped, { ...defaultTimeBankFilters, query: "Bruno" })).toEqual([]);
    expect(filterTimeBank(rows, { ...defaultTimeBankFilters, managerId: "__unassigned__" })).toEqual([rows[3]]);
    expect(filterTimeBank(rows, { ...defaultTimeBankFilters, situation: "AFASTADO" })).toEqual([rows[1]]);
    expect(filterTimeBank(rows, { ...defaultTimeBankFilters, classification: "SEM_EXTRATO" })).toEqual([rows[3]]);
    expect(timeBankMetrics(scoped).total).toBe(2);
  });

  it("ordena minutos numericamente e deixa sem extrato por último", () => {
    const ordered = [
      employee({ employeeNumber: "FICT-100", measuredMinutes: 6000 }),
      employee({ employeeNumber: "FICT-009", measuredMinutes: 540 }),
      employee({ employeeNumber: "FICT-NEG", measuredMinutes: -310 }),
      rows[3],
    ];
    expect(sortTimeBank(ordered, "mostPositive").map((row) => row.employeeNumber))
      .toEqual(["FICT-100", "FICT-009", "FICT-NEG", "FICT-004"]);
    expect(sortTimeBank(ordered, "mostNegative").map((row) => row.employeeNumber))
      .toEqual(["FICT-NEG", "FICT-009", "FICT-100", "FICT-004"]);
  });

  it("saldo medido positivo pode estar em dia após G sem reclassificar o histórico", () => {
    const afterG = employee({ usedCompensationDays: 1, pendingCompensationDays: 0, effectiveDays: 0 });
    expect(classifyTimeBank(afterG)).toBe("POSITIVO");
    expect(timeBankStatusLabel(afterG)).toBe("Em dia após G");
  });
});
