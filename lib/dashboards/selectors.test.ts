import { describe, expect, it } from "vitest";
import { dashboardSnapshotSchema, parseDashboardFilters, type DashboardFilters, type DashboardSnapshot } from "./contracts";
import { buildDailyCallDashboard, buildMonitoringDashboard, buildTimeBankDashboard, buildWorkforceDashboard } from "./selectors";
import { dashboardCsv } from "./export";
import type { WorkforceEmployee } from "@/lib/workforce";
import type { TimeBankEmployee } from "@/lib/time-bank";
import type { Employee } from "@/lib/daily-call-types";
import type { MonitoringRow, MonitoringSnapshot } from "@/lib/monitoring/contracts";

const at = "2026-10-17T15:00:00Z";
const filters: DashboardFilters = { start: "2026-10-16", end: "2026-10-17", unit: "", managerId: "", query: "" };
const manager = "10000000-0000-4000-8000-000000000001";
const otherManager = "10000000-0000-4000-8000-000000000002";
const id = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
function person(value: number, extra: Partial<WorkforceEmployee> = {}): WorkforceEmployee {
  return { id: id(value), employeeNumber: `00${value}`, name: `Pessoa ${value}`, unit: "CD I", manager: "Mesmo nome", managerId: manager, department: null, role: null, situation: "ATIVO", category: null, admissionDate: "2026-01-01", workdayHours: 8, activeInSystem: true, bankMeasurementDate: null, bankBalanceMinutes: null, bankBalanceDays: null, ...extra };
}
function bank(value: number, minutes: number | null): TimeBankEmployee {
  const known = minutes !== null;
  return { ...person(value), measurementDate: known ? "2026-10-01" : null, effectiveFrom: known ? "2026-10-01" : null, measuredMinutes: minutes, measuredDays: known ? 0 : null, usedCompensationDays: 0, pendingCompensationDays: known ? 0 : null, replacementDays: known ? 0 : null, effectiveDays: known ? 0 : null };
}
function call(value: number, extra: Partial<Employee> = {}): Employee {
  return { id: `00${value}`, databaseId: id(value), name: `Pessoa ${value}`, unit: "CD I", manager: "Mesmo nome", department: "Setor", role: "Função", situation: "Ativo", admissionDate: "2026-01-01", plannedVacation: "—", bankDays: null, bankHours: null, realBank: null, attendance: {}, observations: {}, attendanceSources: {}, ...extra };
}
function monitoring(value: number, extra: Partial<MonitoringRow> = {}): MonitoringRow {
  return { employeeId: id(value), employeeNumber: `00${value}`, name: `Pessoa ${value}`, unit: "CD I", manager: "Mesmo nome", managerId: manager, date: filters.end, quality: "complete", dirty: false, computedAt: at, ruleVersion: "test", summary: null, ...extra };
}
function source(rows: MonitoringRow[]): MonitoringSnapshot {
  return { rows, total: rows.length, people: rows.length, pending: 0, excluded: 0, totals: {}, timezone: "America/Sao_Paulo", queriedAt: at, start: filters.start, end: filters.end, datasetVersion: "1:1" };
}
const value = (snapshot: DashboardSnapshot, key: string) => snapshot.metrics.find((entry) => entry.id === key)!;

describe("contratos dos quatro dashboards", () => {
  it("limita Chamada a31dias e Monitoramento a367dias, com datas reais", () => {
    expect(parseDashboardFilters("chamada-diaria", { start: "2026-10-01", end: "2026-10-31" }, filters.end).end).toBe("2026-10-31");
    expect(() => parseDashboardFilters("chamada-diaria", { start: "2026-10-01", end: "2026-11-01" }, filters.end)).toThrow();
    expect(parseDashboardFilters("monitoramento", { start: "2026-10-01", end: "2027-10-02" }, filters.end).end).toBe("2027-10-02");
    expect(() => parseDashboardFilters("monitoramento", { start: "2026-10-01", end: "2027-10-03" }, filters.end)).toThrow();
    expect(() => parseDashboardFilters("monitoramento", { start: "2026-02-30" }, filters.end)).toThrow();
  });
  it("Banco usa datafim histórica e Quadro força data atual", () => {
    expect(parseDashboardFilters("banco-de-horas", { end: "2026-09-01" }, filters.end)).toMatchObject({ start: "2026-09-01", end: "2026-09-01" });
    expect(parseDashboardFilters("quadro-atual", { start: "2026-08-31", end: "2026-08-01" }, filters.end)).toMatchObject({ start: filters.end, end: filters.end });
  });
});

describe("indicadores sobre fontes reais, ausência de cobertura e denominadores", () => {
  it("Quadro mantém estados fora da Chamada e filtra gestor porID, mesmo com nomes iguais", () => {
    const data = [person(1), person(2, { managerId: otherManager, situation: "DESLIGADO" }), person(3, { managerId: null, manager: null, situation: "FERIAS", admissionDate: null })];
    const full = buildWorkforceDashboard(data, filters, at);
    expect(value(full, "registered").value).toBe(3);
    expect(value(full, "operational").value).toBe(2);
    expect(value(full, "managerCoverage")).toMatchObject({ numerator: 2, denominator: 3 });
    const scoped = buildWorkforceDashboard(data, { ...filters, managerId: otherManager }, at);
    expect(value(scoped, "registered").value).toBe(1);
    expect(value(scoped, "operational").value).toBe(0);
    expect(scoped.options.managers).toHaveLength(3);
    expect(dashboardSnapshotSchema.parse(full)).toEqual(full);
  });
  it("denominador vazio produz percentualnull, nunca100% ou0% inventado", () => {
    const result = buildWorkforceDashboard([], filters, at);
    expect(value(result, "managerCoverage")).toMatchObject({ value: null, numerator: 0, denominator: 0 });
  });
  it("Banco distingue extratozero de ausente e não converte G em minutos fictícios", () => {
    const partial = { ...bank(1, 480), measuredDays: 1, usedCompensationDays: 1, pendingCompensationDays: 0, effectiveDays: 0 };
    const result = buildTimeBankDashboard({ asOfDate: filters.end, employees: [partial, bank(2, 0), bank(3, null), bank(4, -60)] }, filters, at);
    expect(value(result, "withExtract").value).toBe(3);
    expect(value(result, "extractCoverage")).toMatchObject({ numerator: 3, denominator: 4, value: 75 });
    expect(value(result, "positiveMinutes").value).toBe(480);
    expect(value(result, "negativeMinutes").value).toBe(60);
    expect(value(result, "pendingDays").value).toBe(0);
    expect(dashboardSnapshotSchema.parse(result)).toEqual(result);
  });
  it("Banco semextratos mantém medidasnull; comextratozero retorna0conhecido", () => {
    const unknown = buildTimeBankDashboard({ asOfDate: filters.end, employees: [bank(1, null)] }, filters, at);
    const zero = buildTimeBankDashboard({ asOfDate: filters.end, employees: [bank(1, 0)] }, filters, at);
    expect(value(unknown, "positiveMinutes").value).toBeNull();
    expect(unknown.table.rows[0].pendingDays).toBeNull();
    expect(value(zero, "positiveMinutes").value).toBe(0);
  });
  it("Chamada conta somenteI como falta injustificada e separa branco,F,X eorigem", () => {
    const employees = [call(1, { attendance: { [filters.end]: "P" }, attendanceSources: { [filters.end]: "punch" } }), call(2, { attendance: { [filters.end]: "F" } }), call(3, { attendance: { [filters.end]: "X" } }), call(4), call(5, { attendance: { [filters.end]: "I" }, attendanceSources: { [filters.end]: "automatic_absence" } })];
    const result = buildDailyCallDashboard({ date: filters.end, startDate: filters.start, endDate: filters.end, employees }, employees.map((_, index) => person(index + 1)), filters, at);
    expect(value(result, "unjustified").value).toBe(1);
    expect(value(result, "unmarked").value).toBe(1);
    expect(value(result, "fillRate")).toMatchObject({ numerator: 4, denominator: 5, value: 80 });
    expect(result.table.rows[1]).toMatchObject({ registered: 4, punch: 1, automaticAbsence: 1, manual: 2 });
    expect(dashboardSnapshotSchema.parse(result)).toEqual(result);
  });
  it("Chamada exclui dias anteriores à admissão e não une gestores homônimos", () => {
    const employees = [call(1, { admissionDate: filters.end }), call(2)];
    const workforce = [person(1, { managerId: otherManager }), person(2)];
    const result = buildDailyCallDashboard({ date: filters.end, startDate: filters.start, endDate: filters.end, employees }, workforce, { ...filters, managerId: otherManager }, at);
    expect(value(result, "employees").value).toBe(1);
    expect(result.table.rows[0].unmarked).toBe(0);
    expect(result.table.rows[1].unmarked).toBe(1);
  });
  it("Chamada rejeita cruzamento de snapshots incompatíveis", () => {
    expect(() => buildDailyCallDashboard({ date: filters.end, startDate: filters.start, endDate: filters.end, employees: [call(1)] }, [], filters, at)).toThrow("DASHBOARD_SOURCE_CHANGED");
  });
  it("Monitor usa denominador específico de atraso e exclui resultadosstale de valores", () => {
    const data = source([
      monitoring(1, { summary: { late: false, workedSeconds: 3600, outsideSeconds: 0, unknownSeconds: 0 } }),
      monitoring(2, { quality: "excluded", summary: { late: true, workedSeconds: 1800, outsideSeconds: null } }),
      monitoring(3, { quality: "stale", dirty: true, summary: { late: true, workedSeconds: 999999, outsideSeconds: 99999 } }),
      monitoring(4, { quality: "unavailable", summary: { late: null, workedSeconds: null, outsideSeconds: null, unknownSeconds: 0 } }),
      monitoring(5, { quality: "pending", date: null }),
    ]);
    const result = buildMonitoringDashboard(data, filters, at);
    expect(value(result, "lateRate")).toMatchObject({ numerator: 1, denominator: 2, value: 50 });
    expect(value(result, "workedMinutes").value).toBe(90);
    expect(value(result, "outsideMinutes").value).toBe(0);
    expect(value(result, "withoutResult").value).toBe(1);
    expect(result.charts[0].points.reduce((sum, point) => sum + (point.value ?? 0), 0)).toBe(4);
    expect(result.charts[1].points[0].value).toBeNull();
    expect(dashboardSnapshotSchema.parse(result)).toEqual(result);
  });
  it("Monitor indisponível não transforma unknownSeconds0 em cobertura comprovada", () => {
    const result = buildMonitoringDashboard(source([monitoring(1, { quality: "unavailable", summary: { late: null, workedSeconds: null, unknownSeconds: 0 } })]), filters, at);
    expect(value(result, "lateRate").value).toBeNull();
    expect(value(result, "workedMinutes").value).toBeNull();
    expect(result.table.rows[1].unknownMinutes).toBeNull();
  });
  it("Monitor recusa uma página isolada e preserva filtrosemgestor", () => {
    expect(() => buildMonitoringDashboard({ ...source([monitoring(1)]), total: 501 }, filters, at)).toThrow("DASHBOARD_INCOMPLETE_MONITORING");
    const result = buildMonitoringDashboard(source([monitoring(1), monitoring(2, { managerId: null, manager: null })]), { ...filters, managerId: "none" }, at);
    expect(value(result, "people").value).toBe(1);
  });
  it("CSV inclui definições, denominadores e protege fórmulas", () => {
    const result = buildWorkforceDashboard([person(1, { manager: "=SUM(1,2)" })], filters, at);
    const csv = dashboardCsv(result);
    expect(csv).toContain("Numerador");
    expect(csv).toContain("'=SUM(1,2)");
    expect(csv).not.toContain('"=SUM(1,2)"');
    expect(csv).toContain("Cadastros com gestor dividido");
  });
});
