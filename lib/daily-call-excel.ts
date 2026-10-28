import type { Cell, RichText, Workbook } from "exceljs";
import type { z } from "zod";
import type { Employee, AttendanceCode } from "@/lib/daily-call-types";
import { validPeriod, todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { attendanceMeta, getBankHoursSummary } from "@/lib/daily-call-rules";
import { attendanceHistorySnapshotSchema } from "@/lib/monitoring/attendance-history-contracts";
import { runPeriodPunchRead } from "@/lib/monitoring/period-punch-requests";

type History = z.infer<typeof attendanceHistorySnapshotSchema>;
type HistoryDay = History["days"][number];
export type DailyCallExcelInput = {
  employees: Employee[];
  start: string;
  end: string;
  managerGroups?: Array<[string, Employee[]]>;
};
type ReadOptions = { signal: AbortSignal; onProgress?: (completed: number, total: number) => void };
type Histories = Map<string, History["days"]>;
const clock = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
const headerWeekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });
const colors: Record<AttendanceCode, [string, string]> = {
  P: ["FFECFDF5", "FF047857"], F: ["FFFFFBEB", "FFB45309"], A: ["FFFFF7ED", "FFC2410C"],
  I: ["FFFFF1F2", "FFBE123C"], B: ["FFF5F3FF", "FF6D28D9"], X: ["FFECFEFF", "FF0E7490"],
  H: ["FFEEF2FF", "FF4338CA"], G: ["FFDCFCE7", "FF166534"], D: ["FFF1F5F9", "FF475569"], AF: ["FFFDF4FF", "FFA21CAF"],
};

function assertInput(input: DailyCallExcelInput) {
  if (!validPeriod(input.start, input.end)) throw new Error("Período inválido para exportação.");
  if (!input.employees.length) throw new Error("Nenhum colaborador para exportar.");
}

/** Read exactly the authorized history used by the expanded Period grid. */
export async function readDailyCallExcelHistories(input: DailyCallExcelInput, options: ReadOptions): Promise<Histories> {
  assertInput(input);
  options.signal.throwIfAborted();
  const histories: Histories = new Map();
  const today = todayInSaoPaulo();
  const end = input.end < today ? input.end : today;
  let completed = 0, next = 0;
  options.onProgress?.(0, input.employees.length);
  // Share the board's four-request limit, including other expanded rows.
  async function worker() {
    while (next < input.employees.length) {
      options.signal.throwIfAborted();
      const employee = input.employees[next++];
      if (employee.databaseId && input.start <= end) {
        const history = await runPeriodPunchRead(options.signal, async () => {
          const response = await fetch(`/api/monitoring/attendance-history?${new URLSearchParams({ employeeId: employee.databaseId!, start: input.start, end })}`, { cache: "no-store", signal: options.signal });
          if (!response.ok) throw new Error(`Não foi possível carregar as batidas de ${employee.name}. Tente exportar novamente.`);
          const parsed = attendanceHistorySnapshotSchema.safeParse(await response.json());
          if (!parsed.success) throw new Error(`O servidor não confirmou as batidas de ${employee.name}. Tente novamente.`);
          const dates = new Set(parsed.data.days.map(day => day.date));
          const expectedDays = (Date.parse(end) - Date.parse(input.start)) / 86_400_000 + 1;
          if (dates.size !== expectedDays || dates.size !== parsed.data.days.length || parsed.data.days.some(day => day.date < input.start || day.date > end)) {
            throw new Error(`O histórico de ${employee.name} está incompleto. Tente exportar novamente.`);
          }
          return parsed.data;
        });
        histories.set(employee.databaseId, history.days);
      }
      options.signal.throwIfAborted();
      options.onProgress?.(++completed, input.employees.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, input.employees.length) }, worker));
  return histories;
}

function dayMarks(day: HistoryDay | undefined) {
  return day?.displayMarks ?? (day?.bankDay?.slots.length ? day.bankDay.slots : day?.bankDay?.punches ?? []);
}

function markText(at: number, date: string) {
  const suffix = todayInSaoPaulo(new Date(at)) === date ? "" : ` ${weekday.format(at).charAt(0).toUpperCase()}`;
  return clock.format(at) + suffix;
}

function styleCell(cell: Cell, fill: string, color = "FF334155", bold = false) {
  cell.font = { name: "Arial", size: 10, color: { argb: color }, bold };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.alignment = { vertical: "middle", wrapText: true };
}

/** Native XLSX values remain text/numbers, so names never become formulas. */
export async function createDailyCallExcel(input: DailyCallExcelInput, histories: Histories, today = todayInSaoPaulo()): Promise<Workbook> {
  assertInput(input);
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RH Conect";
  const sheet = workbook.addWorksheet("Chamada por período", {
    views: [{ state: "frozen", xSplit: 7, ySplit: 4, topLeftCell: "H5", showGridLines: false, zoomScale: 85 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: false, scale: 85 },
  });
  const dates: string[] = [];
  for (let time = Date.parse(`${input.start}T12:00:00Z`); time <= Date.parse(`${input.end}T12:00:00Z`); time += 86_400_000) dates.push(new Date(time).toISOString().slice(0, 10));
  const columnCount = 7 + dates.length;
  const headings = ["Matrícula", "Colaborador", "Gestor", "Férias previstas", "BH em dias", "A compensar / repor", "Situação"];
  [13, 34, 24, 19, 14, 22, 23, ...dates.map(() => 11)].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.mergeCells(1, 1, 1, 7);
  sheet.getCell("A1").value = "Chamada Diária — Período";
  sheet.getCell("A1").font = { name: "Arial", size: 14, bold: true, color: { argb: "FF0F172A" } };
  sheet.getRow(1).height = 25;
  sheet.mergeCells(2, 1, 2, columnCount);
  sheet.getCell("A2").value = `${input.start.split("-").reverse().join("/")} a ${input.end.split("-").reverse().join("/")} · ${input.employees.length} colaboradores`;
  sheet.getRow(2).height = 22;
  sheet.mergeCells(3, 1, 3, columnCount);
  sheet.getCell("A3").value = "Batidas em São Paulo, no dia de entrada. Letra após a hora: outra data. T vermelho: sugestão do torniquete. --:--: batida faltante. —: sem batidas.";
  sheet.getRow(3).height = 24;
  for (const address of ["A2", "A3"]) styleCell(sheet.getCell(address), "FFFFFFFF", "FF475569");
  const header = sheet.getRow(4);
  header.values = [...headings, ...dates.map(date => new Date(`${date}T00:00:00Z`))];
  header.height = 32;
  header.eachCell((cell, col) => {
    styleCell(cell, "FFF1F5F9", "FF475569", true);
    cell.alignment = { vertical: "middle", horizontal: col > 7 ? "center" : "left", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
    if (col > 7) cell.numFmt = `"${headerWeekday.format(new Date(`${dates[col - 8]}T12:00:00Z`)).replace(".", "").toUpperCase()}" dd/mm`;
  });

  const visible = new Map(input.employees.map(employee => [employee.id, employee]));
  const groups: Array<[string, Employee[]]> = input.managerGroups
    ? input.managerGroups.map(([manager, employees]) => [manager, employees.flatMap(employee => visible.has(employee.id) ? [visible.get(employee.id)!] : [])])
    : [["", input.employees]];
  for (const [manager, employees] of groups) {
    if (!employees.length) continue;
    if (manager) {
      const row = sheet.addRow([`${manager} · ${employees.length} ${employees.length === 1 ? "colaborador" : "colaboradores"}`]);
      sheet.mergeCells(row.number, 1, row.number, columnCount);
      styleCell(row.getCell(1), "FFE2E8F0", "FF1E293B", true);
      row.height = 26;
    }
    for (const employee of employees) {
      const bank = getBankHoursSummary(employee);
      const pending = bank.situation === "Sem extrato" ? "Sem extrato" : bank.situation === "A compensar" ? `${bank.pendingCompensationDays}d a compensar` : bank.situation === "A repor" ? `${bank.replacementDays}d a repor` : "Em dia";
      const status = sheet.addRow([employee.id, employee.name, employee.manager, employee.plannedVacation || "—", employee.bankDays ?? "Sem extrato", pending, employee.situation, ...dates.map(date => employee.attendance[date] ?? "—")]);
      status.height = 34;
      status.eachCell((cell, col) => {
        styleCell(cell, "FFFFFFFF");
        cell.alignment = { vertical: "middle", horizontal: col === 5 ? "right" : "left", wrapText: true, indent: 1 };
      });
      status.getCell(1).numFmt = "@";
      status.getCell(2).font = { ...status.getCell(2).font, bold: true };
      if (employee.bankDays !== null) status.getCell(5).numFmt = Number.isInteger(employee.bankDays) ? '0"d"' : '0.##"d"';
      const days = new Map((employee.databaseId ? histories.get(employee.databaseId) ?? [] : []).map(day => [day.date, day]));
      const punches = sheet.addRow([`Batidas do ponto · ${employee.unit}`]);
      sheet.mergeCells(punches.number, 1, punches.number, 7);
      styleCell(punches.getCell(1), "FFEFF6FF", "FF1E3A8A");
      let lines = 1;
      dates.forEach((date, index) => {
        const col = 8 + index;
        const statusCell = status.getCell(col), cell = punches.getCell(col);
        const code = employee.attendance[date];
        if (code) styleCell(statusCell, colors[code][0], colors[code][1], true);
        statusCell.alignment = { vertical: "middle", horizontal: "center" };
        styleCell(cell, "FFEFF6FF");
        cell.alignment = { horizontal: "center", vertical: "top", wrapText: true };
        cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
        const marks = dayMarks(days.get(date));
        if (!marks.length) {
          cell.value = date > today ? "Data futura" : !employee.databaseId ? "Não sincronizado" : "—";
          return;
        }
        lines = Math.max(lines, marks.length);
        const richText: RichText[] = marks.map((mark, i) => ({
          text: (i ? "\n" : "") + (mark.at === null ? "--:--" : markText(mark.at, date) + ("origin" in mark && mark.origin === "turnstile" ? " T" : "")),
          font: { name: "Arial", size: 10, color: { argb: "origin" in mark && mark.origin === "turnstile" ? "FFB91C1C" : mark.at === null ? "FF92400E" : "FF334155" }, bold: "origin" in mark && mark.origin === "turnstile" },
        }));
        cell.value = { richText };
      });
      punches.height = Math.max(34, Math.min(409, lines * 14 + 8));
    }
  }
  const legend = sheet.addRow([Object.values(attendanceMeta).map(meta => `${meta.code}: ${meta.label}`).join(" · ")]);
  sheet.mergeCells(legend.number, 1, legend.number, columnCount);
  styleCell(legend.getCell(1), "FFFFFFFF", "FF475569");
  legend.height = 30;
  sheet.pageSetup.printTitlesRow = "1:4";
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(columnCount).letter}${sheet.rowCount}`;
  return workbook;
}

export async function downloadDailyCallExcel(input: DailyCallExcelInput, options: ReadOptions) {
  const histories = await readDailyCallExcelHistories(input, options);
  const workbook = await createDailyCallExcel(input, histories);
  options.signal.throwIfAborted();
  const buffer = await workbook.xlsx.writeBuffer();
  options.signal.throwIfAborted();
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `chamada-diaria-${input.start}-${input.end}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
