import { describe, expect, it } from "vitest";
import { analysisSnapshotSchema, parseAnalysisFilters, type AnalysisFilters } from "./contracts";
import { buildBankAnalysis, buildOutsideWorkforceAnalysis } from "./selectors";
import { dashboardCsv } from "@/lib/dashboards/export";
import type { TimeBankEmployee } from "@/lib/time-bank";
import type { WorkforceEmployee } from "@/lib/workforce";

const at = "2026-10-17T15:00:00Z";
const day = "2026-10-17";
const filters: AnalysisFilters = { start: day, end: day, unit: "", managerId: "", query: "" };
const manager = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function employee(n: number, extra: Partial<WorkforceEmployee> = {}): WorkforceEmployee {
  return { id: id(n), employeeNumber: `00${n}`, name: `Pessoa ${n}`, unit: "CD I", manager: "Gestor homônimo", managerId: manager, department: null, role: null, situation: "ATIVO", category: null, admissionDate: null, workdayHours: 8, activeInSystem: true, bankMeasurementDate: null, bankBalanceMinutes: null, bankBalanceDays: null, ...extra };
}
function bank(n: number, minutes: number | null, extra: Partial<TimeBankEmployee> = {}): TimeBankEmployee {
  return { ...employee(n), measurementDate: minutes === null ? null : day, effectiveFrom: minutes === null ? null : day, measuredMinutes: minutes, measuredDays: minutes === null ? null : 0, usedCompensationDays: 0, pendingCompensationDays: minutes === null ? null : 0, replacementDays: minutes === null ? null : 0, effectiveDays: minutes === null ? null : 0, ...extra };
}
const build = (rows: TimeBankEmployee[], kind: "top-20-banco-horas" | "top-por-gestor" = "top-20-banco-horas", selection = filters) => buildBankAnalysis(kind, { asOfDate: day, employees: rows }, selection, at);

describe("rankings com base completa e saldos separados", () => {
  it("seleciona até20 por sinal após filtros, sem truncar os cartões ao ranking", () => {
    const rows = [...Array.from({ length: 25 }, (_, i) => bank(i + 1, (i + 1) * 60)), ...Array.from({ length: 22 }, (_, i) => bank(i + 30, -(i + 1) * 60)), bank(60, 0), bank(61, null)];
    const result = build(rows);
    expect(result.table.rows).toHaveLength(40);
    expect(result.table.rows[0]).toMatchObject({ employeeId: id(25), minutes: 1500, rank: 1, side: "Crédito" });
    expect(result.table.rows[20]).toMatchObject({ employeeId: id(51), minutes: -1320, rank: 1, side: "Débito" });
    expect(result.metrics.find((metric) => metric.id === "employees")?.value).toBe(49);
    expect(result.metrics.find((metric) => metric.id === "extractCoverage")).toMatchObject({ numerator: 48, denominator: 49 });
    expect(result.charts[0].description).toContain("20 de 25");
    expect(result.charts[1].description).toContain("20 de 22");
    expect(analysisSnapshotSchema.parse(result)).toEqual(result);
  });
  it("saldo medido não é reduzido por G; dias restantes e a repor preservam a fonte", () => {
    const result = build([bank(1, 960, { measuredDays: 2, usedCompensationDays: 2, pendingCompensationDays: 0 }), bank(2, -960, { measuredDays: -2, replacementDays: 2 })]);
    expect(result.table.rows[0]).toMatchObject({ minutes: 960, usedDays: 2, pendingDays: 0 });
    expect(result.table.rows[1]).toMatchObject({ minutes: -960, replacementDays: 2 });
  });
  it("empate usa identificador estável e não muta entrada", () => {
    const rows = [bank(2, 60, { name: "Mesmo", employeeNumber: "0001" }), bank(1, 60, { name: "Mesmo", employeeNumber: "0001" })];
    expect(build(rows).table.rows.map((row) => row.employeeId)).toEqual([id(1), id(2)]);
    expect(rows[0].id).toBe(id(2));
  });
  it("filtra gestor porUUID, sem gestor e busca normalizada; opções preservam escopo todo", () => {
    const rows = [bank(1, 90), bank(2, 60, { managerId: other, name: "Álvaro" }), bank(3, 120, { manager: null, managerId: null })];
    expect(build(rows, "top-20-banco-horas", { ...filters, managerId: other, query: "alvaro" }).table.rows.map((row) => row.employeeId)).toEqual([id(2)]);
    expect(build(rows, "top-20-banco-horas", { ...filters, managerId: "none" }).table.rows.map((row) => row.employeeId)).toEqual([id(3)]);
    expect(build(rows, "top-20-banco-horas", { ...filters, managerId: other }).options.managers).toHaveLength(3);
  });
  it("mantém equipes homônimas separadas, crédito/débito sem compensação e denominador próprio", () => {
    const result = build([bank(1, 100), bank(2, -100), bank(3, null), bank(4, 30, { managerId: other }), bank(5, null, { managerId: null, manager: null })], "top-por-gestor");
    expect(result.table.rows).toHaveLength(3);
    expect(result.table.rows.find((row) => row.managerId === manager)).toMatchObject({ total: 3, measured: 2, withoutExtract: 1, credit: 100, debt: -100, coverage: 2 / 3 * 100 });
    expect(result.table.rows.find((row) => row.managerId === other)).toMatchObject({ total: 1, measured: 1, credit: 30, debt: 0, coverage: 100 });
    expect(result.table.rows.find((row) => row.managerId === "none")).toMatchObject({ measured: 0, credit: null, debt: null, pendingDays: null, coverage: 0 });
    expect(new Set(result.charts[0].points.map((point) => point.label)).size).toBe(2);
    expect(analysisSnapshotSchema.parse(result)).toEqual(result);
  });
  it("vazio e sem extrato mantêm saldo desconhecido; extrato zero mantém0conhecido", () => {
    for (const rows of [[], [bank(1, null)]]) {
      const result = build(rows);
      expect(result.metrics.find((metric) => metric.id === "positiveMinutes")?.value).toBeNull();
      expect(result.table.rows).toHaveLength(0);
    }
    expect(build([bank(1, 0)]).metrics.find((metric) => metric.id === "positiveMinutes")?.value).toBe(0);
    expect(build([]).metrics.find((metric) => metric.id === "extractCoverage")?.value).toBeNull();
  });
  it("CSV mantém sinais numéricos e bloqueia fórmula em nomes", () => {
    const result = build([bank(1, -960, { name: "=HYPERLINK(unsafe)" })]);
    const csv = dashboardCsv(result);
    expect(csv).toContain("'=HYPERLINK(unsafe)");
    expect(csv).toContain("-960");
    expect(csv).toContain("Top 20");
  });
});

describe("situação cadastral e datas", () => {
  it("lista afastado, desligado, outros e inativo; férias ativa permanece operacional", () => {
    const rows = [employee(1), employee(2, { situation: "FERIAS" }), employee(3, { situation: "AFASTADO" }), employee(4, { situation: "DESLIGADO" }), employee(5, { situation: "ATIVO", activeInSystem: false }), employee(6, { situation: "LICENCA_MATERNIDADE" })];
    const result = buildOutsideWorkforceAnalysis(rows, filters, at);
    expect(result.table.rows.map((row) => row.employeeId)).toEqual([id(3), id(4), id(5), id(6)]);
    expect(result.metrics.find((metric) => metric.id === "outsideRate")).toMatchObject({ numerator: 4, denominator: 6 });
    expect(result.table.rows.find((row) => row.employeeId === id(5))?.reason).toBe("Cadastro inativo no sistema");
    expect(analysisSnapshotSchema.parse(result)).toEqual(result);
  });
  it("filtro não amplia autorização e denominador vazio não é0%", () => {
    const result = buildOutsideWorkforceAnalysis([employee(1)], { ...filters, managerId: other }, at);
    expect(result.table.rows).toHaveLength(0);
    expect(result.metrics.find((metric) => metric.id === "outsideRate")).toMatchObject({ value: null, numerator: 0, denominator: 0 });
  });
  it("BH usa datafim histórica; quadroforça hoje; parâmetros extras rejeitados", () => {
    expect(parseAnalysisFilters("top-por-gestor", { end: "2026-09-01" }, day).start).toBe("2026-09-01");
    expect(parseAnalysisFilters("afastados-e-outros", { end: "2025-01-01" }, day).end).toBe(day);
    expect(() => parseAnalysisFilters("top-20-banco-horas", { userId: "x" }, day)).toThrow();
  });
});
