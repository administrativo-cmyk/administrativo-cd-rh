import { describe, expect, it } from "vitest";
import { payrollPeriodForDate, payrollPeriodForMonth, payrollPeriodOptions } from "./payroll-period";
import { filtersForDate } from "./daily-call-selectors";
import { validPeriod } from "./data/daily-call-dates";

describe("fechamento da folha do dia 21 ao dia 20", () => {
  it.each([
    ["2026-10-19", "2026-09-21", "2026-10-20", "SET/OUT 2026"],
    ["2026-10-20", "2026-09-21", "2026-10-20", "SET/OUT 2026"],
    ["2026-10-21", "2026-10-21", "2026-11-20", "OUT/NOV 2026"],
    ["2027-01-01", "2026-12-21", "2027-01-20", "DEZ/JAN 2026/2027"],
    ["2028-02-29", "2028-02-21", "2028-03-20", "FEV/MAR 2028"],
  ])("atribui %s ao ciclo correto", (date, startDate, endDate, label) => {
    expect(payrollPeriodForDate(date)).toMatchObject({ startDate, endDate, label });
    expect(filtersForDate(date)).toMatchObject({ startDate, endDate });
    expect(validPeriod(startDate, endDate)).toBe(true);
  });
  it("todo ciclo tem datas inclusivas, sem lacunas ou sobreposição entre folhas", () => {
    for (const year of [2026, 2027, 2028]) for (let month = 1; month <= 12; month++) {
      const current = payrollPeriodForMonth(`${year}-${String(month).padStart(2, "0")}`);
      const afterEnd = new Date(Date.parse(`${current.endDate}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      expect(payrollPeriodForDate(afterEnd).startDate).toBe(afterEnd);
      expect(validPeriod(current.startDate, current.endDate)).toBe(true);
    }
  });
  it("lista meses anteriores e futuros com a competência atual", () => {
    const options = payrollPeriodOptions("2026-10-19");
    expect(options).toHaveLength(37);
    expect(options[24]).toMatchObject({ key: "2026-10", label: "SET/OUT 2026" });
    expect(new Set(options.map(option => option.key)).size).toBe(37);
  });
  it.each(["", "2026-13", "2026-00", "26-10", "2026-10-21"])("recusa competência inválida %s", value => {
    expect(() => payrollPeriodForMonth(value)).toThrow("INVALID_PAYROLL_MONTH");
  });
});
