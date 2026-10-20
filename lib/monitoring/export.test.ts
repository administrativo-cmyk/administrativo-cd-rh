import { expect, it } from "vitest";
import type { MonitoringRow } from "./contracts";
import { monitoringCsv } from "./export";

it("omite o indicador desativado de Fora CD e mantém alinhadas as demais colunas do CSV", () => {
  const row: MonitoringRow = {
    employeeId: "30000000-0000-4000-8000-000000000001", name: "Pessoa sintética", employeeNumber: "001",
    unit: "CD I", manager: null, managerId: null, date: "2026-10-08", quality: "complete",
    dirty: false, computedAt: null, ruleVersion: "monitoring-1.5.0",
    summary: { workedSeconds: 28800, restSeconds: 3600, outsideSeconds: 15, cafeteriaSeconds: 12, mealsWithoutRest: 1, mealQuality: "complete", cafeSeconds: 5, outsideCdSeconds: 987654, unknownSeconds: 20, lateSeconds: 25, late: false, coverageRatio: 0.99, scheduleName: "Diurno" },
  };
  const [, header, values] = monitoringCsv([row], {}).split("\r\n").map(line => line.split(";").map(cell => cell.slice(1, -1)));
  expect(header).toHaveLength(values.length);
  expect(header).not.toContain("Fora CD (s)");
  expect(values).not.toContain("987654");
  const exported = Object.fromEntries(header.map((name, index) => [name, values[index]]));
  expect(exported).toMatchObject({ "Trabalhado (s)": "28800", "Fora operação (s)": "15", "Refeitório em W (s)": "12", "Desconhecido operação (s)": "20", "Atraso (s)": "25", "Regra": "monitoring-1.5.0", "Escala": "Diurno" });
});
