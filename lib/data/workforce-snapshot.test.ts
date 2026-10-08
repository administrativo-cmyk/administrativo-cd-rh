import { describe, expect, it } from "vitest";
import { mapWorkforceSnapshot } from "@/lib/data/workforce-snapshot";

const base = {
  id: "30000000-0000-4000-8000-000000000001", employeeNumber: "FICT-001",
  name: "Ana Fictícia", unit: "CD I", manager: null, managerId: null,
  department: null, role: null, situation: "AFASTADO", category: null,
  admissionDate: null, workdayHours: 7.3333, activeInSystem: true,
  bankMeasurementDate: null, bankBalanceMinutes: null, bankBalanceDays: null,
};

describe("contrato do Quadro Atual", () => {
  it("preserva colaborador não operacional sem gestor e sem extrato", () => {
    expect(mapWorkforceSnapshot({ employees: [base] })[0]).toMatchObject({
      situation: "AFASTADO", manager: null, bankBalanceMinutes: null,
    });
  });

  it("mantém saldo zero distinto de ausência de extrato", () => {
    expect(mapWorkforceSnapshot({ employees: [{ ...base, bankMeasurementDate: "2026-09-28", bankBalanceMinutes: 0, bankBalanceDays: 0 }] })[0].bankBalanceMinutes).toBe(0);
  });

  it("rejeita medição parcial ou situação inventada", () => {
    expect(() => mapWorkforceSnapshot({ employees: [{ ...base, bankBalanceMinutes: 0 }] })).toThrow();
    expect(() => mapWorkforceSnapshot({ employees: [{ ...base, situation: "STATUS_INVENTADO" }] })).toThrow();
  });
});
