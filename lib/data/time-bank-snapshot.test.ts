import { describe, expect, it } from "vitest";
import { mapTimeBankSnapshot } from "@/lib/data/time-bank-snapshot";

const base = {
  id: "30000000-0000-4000-8000-000000000001", employeeNumber: "FICT-001",
  name: "Pessoa Fictícia", unit: "CD I", manager: null, managerId: null,
  department: null, role: null, situation: "AFASTADO", workdayHours: 7.3333,
  measurementDate: null, effectiveFrom: null, measuredMinutes: null,
  measuredDays: null, usedCompensationDays: 0,
  pendingCompensationDays: null, replacementDays: null, effectiveDays: null,
};

describe("contrato do Banco de Horas", () => {
  it("preserva pessoa sem extrato, sem gestor e fora da Chamada", () => {
    expect(mapTimeBankSnapshot({ asOfDate: "2026-10-08", employees: [base] }).employees[0])
      .toMatchObject({ measuredMinutes: null, manager: null, situation: "AFASTADO" });
  });

  it("distingue zero de sem extrato e mantém medição histórica após G", () => {
    const zero = { ...base, measurementDate: "2026-09-28", effectiveFrom: "2026-09-28",
      measuredMinutes: 0, measuredDays: 0, pendingCompensationDays: 0,
      replacementDays: 0, effectiveDays: 0 };
    const afterG = { ...zero, measuredMinutes: 880, measuredDays: 2,
      usedCompensationDays: 1, pendingCompensationDays: 1, effectiveDays: 1 };
    expect(mapTimeBankSnapshot({ asOfDate: "2026-10-08", employees: [zero, afterG] }).employees)
      .toMatchObject([{ measuredMinutes: 0 }, { measuredMinutes: 880, effectiveDays: 1 }]);
  });

  it("rejeita medição parcial e dias efetivos inconsistentes", () => {
    expect(() => mapTimeBankSnapshot({ asOfDate: "2026-10-08",
      employees: [{ ...base, measuredMinutes: 0 }] })).toThrow();
    expect(() => mapTimeBankSnapshot({ asOfDate: "2026-10-08",
      employees: [{ ...base, measurementDate: "2026-09-28", effectiveFrom: "2026-09-28",
        measuredMinutes: -880, measuredDays: -2, pendingCompensationDays: 0,
        replacementDays: 2, effectiveDays: 1 }] })).toThrow();
  });
});
