import { createHash } from "node:crypto";
import { convertHoursToDays } from "../domain/bank-hours.ts";
import {
  comparableText, isMeasured, journeyMinutesForFunction, normalizeSituation, normalizeUnit,
  normalizedText, parseExcelDate, parseExcelDurationMinutes, parseMatricula,
  parseSignedHhMm,
  type EmployeeSituation, type UnitCode,
} from "./normalize.ts";
import { cellValue, loadWorkbook, type LocatedRow, type LocatedTable } from "./workbook.ts";

export type Severity = "BLOCKER" | "WARNING" | "INFO";
export type ImportIssue = { severity: Severity; code: string; sheet?: string; row?: number; matricula?: string };

export type Employee = {
  matricula: string; nome: string; unidade: UnitCode; setor: string; funcao: string;
  situacao: EmployeeSituation; situacaoOriginal: string; admissao: string;
  jornadaMinutos: number; gestor: string | null; gerente: string | null;
  vinculoGestor: "RESOLVIDO" | "VINCULO_GESTOR_PENDENTE";
  agrupamentoGestor: string;
};
export type BankEntry = { matricula: string; saldoMinutos: number; dias: number };
export type VacationEntry = { matricula: string; inicioAquisitivo: string; fimAquisitivo: string; avos: number };
export type Movement = { matricula: string; kind: "ADMITIDO" | "NAO_ENCONTRADO" | "GESTOR" | "UNIDADE" | "SETOR" | "FUNCAO" | "SITUACAO" };
export type PreviousSnapshot = { employees: Employee[] };

export type DryRunSummary = {
  source: { sheets: string[]; snapshotDate: string | null; dateOrigin: "SOURCE" | "EXPLICIT" | null; records: { quadro: number; bank: number; vacation: number; manager: number } };
  population: { total: number; measured: number; outsideMeasurement: number; situations: Record<string, number>; units: Record<string, number> };
  managers: { unique: number; withManager: number; withoutManager: number; measuredWithoutManager: number; orphanRows: number; unitConflicts: number };
  bank: { rows: number; positive: number; zero: number; negative: number; minMinutes: number | null; maxMinutes: number | null; both: number; onlyQuadro: number; onlyBank: number; measuredWithoutExtract: number; nameConflicts: number; unitConflicts: number };
  vacation: { rows: number; both: number; onlyQuadro: number; onlyVacation: number; nameConflicts: number };
  history: { mode: "BASELINE" | "COMPARISON"; movements: Record<string, number> };
  golden: null | { sheets: string[]; snapshotDate: string | null; quadroRows: number; bankRows: number; overlap: number; unitDifferences: number; situationDifferences: number; managerDifferences: number; journeyDifferences: number; currentPositive: number; currentZero: number; currentNegative: number; balanceExactMatches: number; balanceCompared: number; hhmmCompared: number; hhmmDisagreements: number; temporalComparisonAllowed: boolean };
  issues: { BLOCKER: number; WARNING: number; INFO: number; byCode: Record<string, number> };
  planFingerprint: string;
  remoteWrites: 0;
};

export type DryRunResult = {
  summary: DryRunSummary;
  private: { employees: Employee[]; bank: BankEntry[]; vacation: VacationEntry[]; issues: ImportIssue[]; movements: Movement[] };
};

function value(row: LocatedRow, header: string): unknown { return cellValue(row.cell(header)); }
function key(row: LocatedRow, header: string): string | null {
  const cell = row.cell(header);
  return parseMatricula(cellValue(cell), cell.numFmt);
}
function count<T extends string>(values: Iterable<T>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of values) result[item] = (result[item] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
function issue(issues: ImportIssue[], severity: Severity, code: string, row?: LocatedRow, sheet?: string, matricula?: string): void {
  issues.push({ severity, code, ...(row ? { row: row.line } : {}), ...(sheet ? { sheet } : {}), ...(matricula ? { matricula } : {}) });
}
function indexByKey<T extends { matricula: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.matricula, row]));
}

export function parseReferenceDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  const date = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : brazilian ? `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}` : null;
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function sourceReferenceDate(book: Awaited<ReturnType<typeof loadWorkbook>>, tables: LocatedTable[]): { date: string | null; conflict: boolean } {
  const dates = new Set<string>();
  let conflict = false;
  for (const table of tables) {
    const sheet = book.workbook.worksheets.find((item) => item.name === table.sheet);
    if (!sheet) continue;
    for (let rowNumber = 1; rowNumber < table.headerRow; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      for (let column = 1; column <= row.cellCount; column += 1) {
        if (comparableText(cellValue(row.getCell(column))) !== "DATA DE REFERENCIA") continue;
        const date = parseReferenceDate(cellValue(row.getCell(column + 1)));
        if (date) dates.add(date);
        else conflict = true;
      }
    }
  }
  return { date: !conflict && dates.size === 1 ? [...dates][0] : null, conflict: conflict || dates.size > 1 };
}

export function compareSnapshots(current: Employee[], previous?: PreviousSnapshot): Movement[] {
  if (!previous) return [];
  const before = indexByKey(previous.employees);
  const now = indexByKey(current);
  const result: Movement[] = [];
  for (const employee of current) {
    const old = before.get(employee.matricula);
    if (!old) { result.push({ matricula: employee.matricula, kind: "ADMITIDO" }); continue; }
    for (const [field, kind] of [
      ["gestor", "GESTOR"], ["unidade", "UNIDADE"], ["setor", "SETOR"],
      ["funcao", "FUNCAO"], ["situacao", "SITUACAO"],
    ] as const) {
      if (employee[field] !== old[field]) result.push({ matricula: employee.matricula, kind });
    }
  }
  for (const employee of previous.employees) {
    if (!now.has(employee.matricula)) result.push({ matricula: employee.matricula, kind: "NAO_ENCONTRADO" });
  }
  return result.sort((a, b) => a.matricula.localeCompare(b.matricula) || a.kind.localeCompare(b.kind));
}

async function inspectGolden(path: string, employees: Employee[], bank: BankEntry[]): Promise<DryRunSummary["golden"]> {
  const book = await loadWorkbook(path);
  const quadro = book.table("Quadro Atual", ["MATRÍCULA", "UNIDADE", "SITUAÇÃO", "GESTOR"]);
  const bankTable = book.table("Banco de Horas", ["MATRÍCULA", "JORNADA (H/DIA)", "UNIDADE"]);
  const employeesByKey = indexByKey(employees);
  const bankByKey = indexByKey(bank);
  const bankSheet = book.workbook.worksheets.find((sheet) => comparableText(sheet.name) === "BANCO DE HORAS");
  if (!bankSheet || !comparableText(cellValue(bankSheet.getCell("O3"))).includes("MENSURACAO ATUAL")) {
    throw new Error("Golden master: grupo MENSURAÇÃO ATUAL não encontrado na coluna O");
  }
  const quadroRows = quadro.rows.filter((row) => key(row, "MATRÍCULA"));
  const bankRows = bankTable.rows.filter((row) => key(row, "MATRÍCULA"));
  let overlap = 0, unitDifferences = 0, situationDifferences = 0, managerDifferences = 0, journeyDifferences = 0;
  for (const row of quadroRows) {
    const employee = employeesByKey.get(key(row, "MATRÍCULA") ?? "");
    if (!employee) continue;
    overlap += 1;
    if (normalizeUnit(value(row, "UNIDADE")) !== employee.unidade) unitDifferences += 1;
    if (normalizeSituation(value(row, "SITUAÇÃO")) !== employee.situacao) situationDifferences += 1;
    if (comparableText(value(row, "GESTOR")) !== comparableText(employee.gestor)) managerDifferences += 1;
  }
  let currentPositive = 0, currentZero = 0, currentNegative = 0, balanceExactMatches = 0, balanceCompared = 0, hhmmCompared = 0, hhmmDisagreements = 0;
  for (const row of bankRows) {
    const matricula = key(row, "MATRÍCULA") ?? "";
    const employee = employeesByKey.get(matricula);
    const journey = value(row, "JORNADA (H/DIA)");
    if (employee && typeof journey === "number" && Math.round(journey * 60) !== employee.jornadaMinutos) journeyDifferences += 1;
    const currentHours = cellValue(bankSheet.getRow(row.line).getCell(15));
    if (typeof currentHours !== "number" || !Number.isFinite(currentHours)) continue;
    const minutes = Math.round(currentHours * 60);
    const hhmm = cellValue(bankSheet.getRow(row.line).getCell(16));
    const hhmmMinutes = typeof hhmm === "string" ? parseSignedHhMm(hhmm) : null;
    if (hhmmMinutes !== null) {
      hhmmCompared += 1;
      if (Math.abs(hhmmMinutes - minutes) > 1) hhmmDisagreements += 1;
    }
    if (minutes > 0) currentPositive += 1;
    else if (minutes < 0) currentNegative += 1;
    else currentZero += 1;
    const sourceBalance = bankByKey.get(matricula);
    if (sourceBalance) {
      balanceCompared += 1;
      if (sourceBalance.saldoMinutos === minutes) balanceExactMatches += 1;
    }
  }
  const title = String(cellValue(bankSheet.getCell("A1")) ?? "");
  const dateMatch = /MENSURAÇÃO ATUAL:\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(title);
  const snapshotDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;
  return {
    sheets: book.workbook.worksheets.map((sheet) => sheet.name), snapshotDate,
    quadroRows: quadroRows.length, bankRows: bankRows.length, overlap,
    unitDifferences, situationDifferences, managerDifferences, journeyDifferences,
    currentPositive, currentZero, currentNegative, balanceExactMatches, balanceCompared, hhmmCompared, hhmmDisagreements,
    temporalComparisonAllowed: false,
  };
}

export async function runDryImport(sourcePath: string, referencePath?: string, previous?: PreviousSnapshot, sourceSnapshotDate?: string): Promise<DryRunResult> {
  const book = await loadWorkbook(sourcePath);
  const quadroTable = book.table("Quadro", ["Código da Filial", "Nome do Departamento", "Chapa", "Nome", "Descrição Seção", "Nome Funcão", "Descrição da Situação", "Data de Admissão"]);
  const bankTable = book.table("Banco de horas", ["FILIAL", "CHAPA", "NOME", "DESCRICAO", "FUNÇÃO", "SITUACAO", "SALDO POSITIVO"]);
  const vacationTable = book.table("Férias", ["COD FILIAL", "FILIAL", "CHAPA", "NOME", "INICIO AQUISITIVO", "FIM AQUISITIVO", "AVOS"]);
  const managerTable = book.table("Gerente | Gestor", ["GERENTE", "GESTOR", "MATR.", "COLABORADOR", "UNID."]);
  const issues: ImportIssue[] = [];
  const detectedDate = sourceReferenceDate(book, [quadroTable, bankTable]);
  if (sourceSnapshotDate && !parseReferenceDate(sourceSnapshotDate)) throw new Error("Data de refer�ncia inv�lida: use YYYY-MM-DD");
  const resolvedDate = detectedDate.date ?? sourceSnapshotDate ?? null;
  const dateOrigin = detectedDate.date ? "SOURCE" : sourceSnapshotDate ? "EXPLICIT" : null;
  if (detectedDate.conflict) issue(issues, "WARNING", "SOURCE_REFERENCE_DATE_CONFLICT");
  if (detectedDate.date && sourceSnapshotDate && detectedDate.date !== sourceSnapshotDate) issue(issues, "WARNING", "EXPLICIT_REFERENCE_DATE_OVERRIDDEN");

  const managers = new Map<string, { gerente: string; gestor: string; unidade: UnitCode | null; nome: string; row: LocatedRow }>();
  for (const row of managerTable.rows) {
    const matricula = key(row, "MATR.");
    if (!matricula) { issue(issues, "BLOCKER", "INVALID_MANAGER_KEY", row, managerTable.sheet); continue; }
    if (managers.has(matricula)) { issue(issues, "BLOCKER", "DUPLICATE_MANAGER_KEY", row, managerTable.sheet, matricula); continue; }
    const gestor = normalizedText(value(row, "GESTOR"));
    if (!gestor) issue(issues, "WARNING", "EMPTY_MANAGER_NAME", row, managerTable.sheet, matricula);
    managers.set(matricula, {
      gerente: normalizedText(value(row, "GERENTE")), gestor,
      unidade: normalizeUnit(value(row, "UNID.")), nome: normalizedText(value(row, "COLABORADOR")), row,
    });
  }

  const employees: Employee[] = [];
  const seenEmployees = new Set<string>();
  for (const row of quadroTable.rows) {
    const matricula = key(row, "Chapa");
    if (!matricula) { issue(issues, "BLOCKER", "INVALID_EMPLOYEE_KEY", row, quadroTable.sheet); continue; }
    if (seenEmployees.has(matricula)) { issue(issues, "BLOCKER", "DUPLICATE_EMPLOYEE_KEY", row, quadroTable.sheet, matricula); continue; }
    seenEmployees.add(matricula);
    const unidade = normalizeUnit(value(row, "Nome do Departamento"));
    const situacao = normalizeSituation(value(row, "Descrição da Situação"));
    const nome = normalizedText(value(row, "Nome"));
    const admissao = parseExcelDate(value(row, "Data de Admissão"));
    if (!unidade) issue(issues, "BLOCKER", "UNKNOWN_UNIT", row, quadroTable.sheet, matricula);
    if (!situacao) issue(issues, "BLOCKER", "UNKNOWN_SITUATION", row, quadroTable.sheet, matricula);
    if (!nome) issue(issues, "BLOCKER", "EMPTY_NAME", row, quadroTable.sheet, matricula);
    if (!admissao) issue(issues, "BLOCKER", "INVALID_ADMISSION_DATE", row, quadroTable.sheet, matricula);
    if (!unidade || !situacao || !nome || !admissao) continue;
    const match = managers.get(matricula);
    if (!match) issue(issues, "WARNING", "MISSING_MANAGER", row, quadroTable.sheet, matricula);
    else {
      if (match.unidade !== unidade) issue(issues, "WARNING", "MANAGER_UNIT_CONFLICT", match.row, managerTable.sheet, matricula);
      if (comparableText(match.nome) !== comparableText(nome)) issue(issues, "WARNING", "MANAGER_NAME_CONFLICT", match.row, managerTable.sheet, matricula);
    }
    const funcao = normalizedText(value(row, "Nome Funcão"));
    employees.push({
      matricula, nome, unidade, setor: normalizedText(value(row, "Descrição Seção")), funcao,
      situacao, situacaoOriginal: normalizedText(value(row, "Descrição da Situação")), admissao,
      jornadaMinutos: journeyMinutesForFunction(funcao), gestor: match?.gestor || null, gerente: match?.gerente || null,
      vinculoGestor: match?.gestor ? "RESOLVIDO" : "VINCULO_GESTOR_PENDENTE",
      agrupamentoGestor: match?.gestor || "Sem gestor definido",
    });
  }
  employees.sort((a, b) => a.matricula.localeCompare(b.matricula));
  const employeesByKey = indexByKey(employees);

  const bank: BankEntry[] = [];
  const bankNames = new Map<string, string>();
  const bankUnits = new Map<string, UnitCode | null>();
  const bankSituations = new Map<string, string>();
  const seenBank = new Set<string>();
  for (const row of bankTable.rows) {
    const matricula = key(row, "CHAPA");
    if (!matricula) { issue(issues, "BLOCKER", "INVALID_BANK_KEY", row, bankTable.sheet); continue; }
    if (seenBank.has(matricula)) { issue(issues, "BLOCKER", "DUPLICATE_BANK_KEY", row, bankTable.sheet, matricula); continue; }
    seenBank.add(matricula);
    const minutes = parseExcelDurationMinutes(value(row, "SALDO POSITIVO"), book.date1904);
    if (minutes === null) { issue(issues, "BLOCKER", "INVALID_BANK_BALANCE", row, bankTable.sheet, matricula); continue; }
    const employee = employeesByKey.get(matricula);
    if (!employee) issue(issues, "WARNING", "BANK_WITHOUT_QUADRO", row, bankTable.sheet, matricula);
    bankNames.set(matricula, normalizedText(value(row, "NOME")));
    bankUnits.set(matricula, normalizeUnit(value(row, "FILIAL")));
    bankSituations.set(matricula, comparableText(value(row, "SITUACAO")));
    bank.push({ matricula, saldoMinutos: minutes, dias: employee ? convertHoursToDays(minutes / 60, employee.jornadaMinutos / 60) : 0 });
  }
  bank.sort((a, b) => a.matricula.localeCompare(b.matricula));
  const bankByKey = indexByKey(bank);

  const vacation: VacationEntry[] = [];
  const vacationNames = new Map<string, string>();
  const seenVacation = new Set<string>();
  for (const row of vacationTable.rows) {
    const matricula = key(row, "CHAPA");
    if (!matricula) { issue(issues, "BLOCKER", "INVALID_VACATION_KEY", row, vacationTable.sheet); continue; }
    if (seenVacation.has(matricula)) { issue(issues, "BLOCKER", "DUPLICATE_VACATION_KEY", row, vacationTable.sheet, matricula); continue; }
    seenVacation.add(matricula);
    const inicio = parseExcelDate(value(row, "INICIO AQUISITIVO"));
    const fim = parseExcelDate(value(row, "FIM AQUISITIVO"));
    const avos = Number(value(row, "AVOS"));
    if (!inicio || !fim || !Number.isFinite(avos)) issue(issues, "WARNING", "INVALID_VACATION_DETAIL", row, vacationTable.sheet, matricula);
    vacationNames.set(matricula, normalizedText(value(row, "NOME")));
    if (inicio && fim && Number.isFinite(avos)) vacation.push({ matricula, inicioAquisitivo: inicio, fimAquisitivo: fim, avos });
  }
  vacation.sort((a, b) => a.matricula.localeCompare(b.matricula));

  let bankNameConflicts = 0, bankUnitConflicts = 0, vacationNameConflicts = 0;
  for (const employee of employees) {
    if (!bankByKey.has(employee.matricula)) issue(issues, isMeasured(employee.situacao) ? "WARNING" : "INFO", "NO_BANK_EXTRACT", undefined, bankTable.sheet, employee.matricula);
    else {
      if (comparableText(bankNames.get(employee.matricula)) !== comparableText(employee.nome)) { bankNameConflicts += 1; issue(issues, "WARNING", "BANK_NAME_CONFLICT", undefined, bankTable.sheet, employee.matricula); }
      if (bankUnits.get(employee.matricula) !== employee.unidade) { bankUnitConflicts += 1; issue(issues, "WARNING", "BANK_UNIT_CONFLICT", undefined, bankTable.sheet, employee.matricula); }
      const bankSituation = bankSituations.get(employee.matricula);
      const expectedBankSituation = employee.situacao === "ATIVO" ? "A" : employee.situacao === "FERIAS" ? "F" : employee.situacao === "AVISO_PREVIO" ? "V" : null;
      if (expectedBankSituation && bankSituation !== expectedBankSituation) issue(issues, "WARNING", "BANK_SITUATION_CONFLICT", undefined, bankTable.sheet, employee.matricula);
    }
    if (vacationNames.has(employee.matricula) && comparableText(vacationNames.get(employee.matricula)) !== comparableText(employee.nome)) {
      vacationNameConflicts += 1; issue(issues, "WARNING", "VACATION_NAME_CONFLICT", undefined, vacationTable.sheet, employee.matricula);
    }
  }
  for (const matricula of managers.keys()) if (!employeesByKey.has(matricula)) issue(issues, "WARNING", "MANAGER_WITHOUT_QUADRO", undefined, managerTable.sheet, matricula);
  for (const matricula of vacationNames.keys()) if (!employeesByKey.has(matricula)) issue(issues, "INFO", "VACATION_WITHOUT_QUADRO", undefined, vacationTable.sheet, matricula);

  // Only explicit metadata above an operational table or an explicitly supplied date qualifies.
  // Methodology, golden master and filesystem timestamps are never date sources.
  if (!resolvedDate) issue(issues, "BLOCKER", "DATA_REFERENCIA_NAO_INFORMADA");
  // Whether an older workbook was manually filtered is provenance supplied by an operator,
  // not a property that can be inferred from the balance values of every new export.
  if (quadroTable.rows.some((row) => typeof value(row, "Chapa") === "number")) issue(issues, "INFO", "NUMERIC_SOURCE_MATRICULA");

  const movements = compareSnapshots(employees, previous);
  const golden = referencePath ? await inspectGolden(referencePath, employees, bank) : null;
  if (golden) issue(issues, "WARNING", "SOURCE_GOLDEN_SNAPSHOT_NOT_COMPARABLE");

  const employeeKeys = new Set(employees.map((row) => row.matricula));
  const bankKeys = new Set(bank.map((row) => row.matricula));
  const vacationKeys = new Set(vacationNames.keys());
  const managerKeys = new Set(managers.keys());
  const balances = bank.map((row) => row.saldoMinutos);
  const fingerprintPayload = { employees, bank, vacation, movements };
  const planFingerprint = createHash("sha256").update(JSON.stringify(fingerprintPayload)).digest("hex");
  const byCode = count(issues.map((item) => item.code));
  const summary: DryRunSummary = {
    source: { sheets: book.workbook.worksheets.map((sheet) => sheet.name), snapshotDate: resolvedDate, dateOrigin,
      records: { quadro: quadroTable.rows.length, bank: bankTable.rows.length, vacation: vacationTable.rows.length, manager: managerTable.rows.length } },
    population: { total: employees.length, measured: employees.filter((row) => isMeasured(row.situacao)).length,
      outsideMeasurement: employees.filter((row) => !isMeasured(row.situacao)).length,
      situations: count(employees.map((row) => row.situacao)), units: count(employees.map((row) => row.unidade)) },
    managers: { unique: new Set([...managers.values()].map((row) => comparableText(row.gestor))).size,
      withManager: employees.filter((row) => row.gestor).length, withoutManager: employees.filter((row) => !row.gestor).length,
      measuredWithoutManager: employees.filter((row) => isMeasured(row.situacao) && !row.gestor).length,
      orphanRows: [...managerKeys].filter((key) => !employeeKeys.has(key)).length,
      unitConflicts: byCode.MANAGER_UNIT_CONFLICT ?? 0 },
    bank: { rows: bank.length, positive: balances.filter((value) => value > 0).length,
      zero: balances.filter((value) => value === 0).length, negative: balances.filter((value) => value < 0).length,
      minMinutes: balances.length ? Math.min(...balances) : null, maxMinutes: balances.length ? Math.max(...balances) : null,
      both: [...employeeKeys].filter((key) => bankKeys.has(key)).length,
      onlyQuadro: [...employeeKeys].filter((key) => !bankKeys.has(key)).length,
      onlyBank: [...bankKeys].filter((key) => !employeeKeys.has(key)).length,
      measuredWithoutExtract: employees.filter((row) => isMeasured(row.situacao) && !bankKeys.has(row.matricula)).length,
      nameConflicts: bankNameConflicts, unitConflicts: bankUnitConflicts },
    vacation: { rows: vacationNames.size, both: [...employeeKeys].filter((key) => vacationKeys.has(key)).length,
      onlyQuadro: [...employeeKeys].filter((key) => !vacationKeys.has(key)).length,
      onlyVacation: [...vacationKeys].filter((key) => !employeeKeys.has(key)).length,
      nameConflicts: vacationNameConflicts },
    history: { mode: previous ? "COMPARISON" : "BASELINE", movements: count(movements.map((row) => row.kind)) },
    golden,
    issues: { BLOCKER: issues.filter((row) => row.severity === "BLOCKER").length,
      WARNING: issues.filter((row) => row.severity === "WARNING").length,
      INFO: issues.filter((row) => row.severity === "INFO").length, byCode },
    planFingerprint,
    remoteWrites: 0,
  };
  return { summary, private: { employees, bank, vacation, issues, movements } };
}
