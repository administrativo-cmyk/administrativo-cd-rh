import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDailyCallExcel, readDailyCallExcelHistories } from "./daily-call-excel";
import type { Employee } from "./daily-call-types";
import { attendanceHistorySnapshotSchema } from "./monitoring/attendance-history-contracts";

const employee: Employee = { id: "00042", databaseId: "00000000-0000-4000-8000-000000000042", name: '=HYPERLINK("bad")', unit: "CD I", manager: "Gestor A", department: "Operação", role: "Auxiliar", situation: "Ativo", admissionDate: "2025-01-01", plannedVacation: "—", bankDays: null, bankHours: null, realBank: null, attendance: { "2026-10-01": "P", "2026-10-03": "D" }, observations: {} };
const input = { employees: [employee], start: "2026-10-01", end: "2026-10-03" };
const day = { date: "2026-10-01", bankDay: null, correctionVersion: null, displayMarks: [{ at: Date.parse("2026-10-01T22:00:00-03:00") }, { at: null, role: "breakStart" }, { at: Date.parse("2026-10-02T01:00:00-03:00"), role: "breakEnd", origin: "turnstile" }, { at: Date.parse("2026-10-02T06:20:00-03:00") }] };
const history = attendanceHistorySnapshotSchema.parse({ days: [day, { date: "2026-10-02", bankDay: null, correctionVersion: null }], bank: null, canEdit: false, correctionHistory: [] });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Excel da Chamada no layout Período", () => {
  it("reabre XLSX com duas linhas, datas alinhadas, matrícula textual e sugestões distintas", async () => {
    const workbook = await createDailyCallExcel(input, new Map([[employee.databaseId!, history.days]]), "2026-10-02");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = reopened.worksheets[0];
    expect(sheet.rowCount).toBe(7); // four headers, two employee rows, status legend
    expect(sheet.getCell("A5").value).toBe("00042");
    expect(sheet.getCell("B5").value).toBe(employee.name);
    expect(sheet.getCell("B5").type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell("E5").value).toBe("Sem extrato");
    expect(sheet.getCell("H4").value).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(sheet.getCell("J4").value).toEqual(new Date("2026-10-03T00:00:00Z"));
    expect([sheet.getCell("H5").value, sheet.getCell("I5").value, sheet.getCell("J5").value]).toEqual(["P", "—", "D"]);
    expect(sheet.getCell("H6").text).toBe("22:00\n--:--\n01:00 S T\n06:20 S");
    expect(sheet.getCell("H6").value).toMatchObject({ richText: expect.arrayContaining([expect.objectContaining({ text: "\n01:00 S T", font: expect.objectContaining({ color: { argb: "FFB91C1C" } }) })]) });
    expect(sheet.getCell("I6").value).toBe("—");
    expect(sheet.getCell("J6").value).toBe("Data futura");
    expect(sheet.getRow(6).height).toBeGreaterThanOrEqual(64);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", xSplit: 7, ySplit: 4 });
  });

  it("mantém ordem dos grupos visíveis e zeros reais", async () => {
    const second = { ...employee, id: "2", databaseId: "00000000-0000-4000-8000-000000000002", name: "Pessoa B", manager: "Gestor B", bankDays: 0, bankHours: "0:00", realBank: undefined };
    const workbook = await createDailyCallExcel({ ...input, employees: [employee, second], managerGroups: [["Gestor B", [second]], ["Gestor A", [employee]], ["Equipe fora do filtro", [{ ...employee, id: "outside" }]]] }, new Map(), "2026-10-03");
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell("A5").value).toBe("Gestor B · 1 colaborador");
    expect(sheet.getCell("A6").value).toBe("2");
    expect(sheet.getCell("E6").value).toBe(0);
    expect(sheet.getCell("A8").value).toBe("Gestor A · 1 colaborador");
    expect(sheet.getCell("A9").value).toBe("00042");
    expect(sheet.rowCount).toBe(11);
  });

  it("consulta só até hoje, com limite de quatro leituras e progresso", async () => {
    let active = 0, maximum = 0;
    const fetcher = vi.fn(async (url: string) => {
      active++; maximum = Math.max(maximum, active);
      expect(url).toContain("end=2026-10-02");
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return { ok: true, json: async () => history };
    });
    vi.stubGlobal("fetch", fetcher);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T12:00:00-03:00"));
    try {
      const employees = Array.from({ length: 9 }, (_, index) => ({ ...employee, id: `${index}`, databaseId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
      const progress = vi.fn();
      const histories = await readDailyCallExcelHistories({ ...input, employees }, { signal: new AbortController().signal, onProgress: progress });
      expect(histories.size).toBe(9);
      expect(maximum).toBe(4);
      expect(progress).toHaveBeenLastCalledWith(9, 9);
    } finally { vi.useRealTimers(); }
  });

  it("impede arquivo incompleto em erro, histórico parcial ou cancelamento", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(readDailyCallExcelHistories(input, { signal: new AbortController().signal })).rejects.toThrow("Não foi possível carregar");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...history, days: [] }) }));
    await expect(readDailyCallExcelHistories(input, { signal: new AbortController().signal })).rejects.toThrow("incompleto");
    const controller = new AbortController(); controller.abort();
    await expect(readDailyCallExcelHistories(input, { signal: controller.signal })).rejects.toThrow();
  });
});
