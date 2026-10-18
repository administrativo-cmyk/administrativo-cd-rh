import { describe, expect, it } from "vitest";
import { exportDailyCall } from "@/lib/daily-call-export";
import type { Employee } from "@/lib/daily-call-types";

const employee: Employee = { id: "00042", name: '=HYPERLINK("bad")', unit: "CD IV", manager: "Gestor", department: "Operação", role: "Auxiliar", situation: "Ativo", admissionDate: "", plannedVacation: "", bankDays: null, bankHours: null, realBank: null, attendance: { "2026-10-01": "P", "2026-10-03": "I" }, attendanceSources: { "2026-10-01": "punch", "2026-10-03": "automatic_absence" }, observations: { "2026-10-01": "Conferido; com gestor" } };

describe("exportação da Chamada", () => {
  it("preserva matrícula e distingue célula vazia de falta automática", () => {
    const csv = exportDailyCall([employee], "2026-10-01", "2026-10-03");
    expect(csv).toContain('"00042"');
    expect(csv).toContain('"2026-10-01";"P";"Presente";"Importação de ponto"');
    expect(csv).toContain('"2026-10-02";"";"Sem marcação";""');
    expect(csv).toContain('"2026-10-03";"I";"Falta injustificada";"Falta automática"');
    expect(csv.split("\r\n")).toHaveLength(5);
  });
  it("escapa separadores, aspas e fórmulas em textos do usuário", () => {
    const csv = exportDailyCall([employee], "2026-10-01", "2026-10-01");
    expect(csv).toContain(`"'=HYPERLINK(""bad"")"`);
    expect(csv).toContain('"Conferido; com gestor"');
  });
  it("recusa período inválido e fora do limite consultado", () => {
    expect(() => exportDailyCall([employee], "2026-02-30", "2026-03-02")).toThrow();
    expect(() => exportDailyCall([employee], "2026-10-01", "2026-11-01")).toThrow();
  });
});
