import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { isStrictMonitoringIdentifier } from "./identifiers";
import { validateWorkbookArchive } from "./ingestion/parsers";
import { ImportError } from "./ingestion/validation";
import type { ImportInspection, ImportKind, ImportOptions } from "./operations-contracts";
import { importFileLimitBytes } from "./payload-limits";
const MAX_ROWS = 2000;
type Cell = { text: string; formula?: boolean; date?: boolean };
type Sheet = { name: string; rows: Cell[][] };
export class ImportFileError extends Error { constructor(public readonly code: string) { super(code); } }
function fail(code: string): never { throw new ImportFileError(code); }

/** Inspect archive sizes before ExcelJS expands any XML. No entry is extracted to disk. */
function guardWorkbook(bytes: Buffer) {
  try { validateWorkbookArchive(bytes, 40 * 1024 * 1024); }
  catch (error) {
    if (error instanceof ImportError && /LIMIT|EXPANSION/.test(error.code)) fail("XLSX_LIMITE_EXCEDIDO");
    fail("XLSX_INVALIDO");
  }
}

export function parseCsv(text: string, delimiter: string): Cell[][] {
  const rows: Cell[][] = []; let row: Cell[] = []; let cell = ""; let quoted = false; let closed = false;
  const pushCell = () => { if (cell.length > 1000) fail("CELULA_LIMITE_EXCEDIDO"); row.push({ text: cell }); cell = ""; closed = false; if (row.length > 100) fail("COLUNAS_LIMITE_EXCEDIDO"); };
  const pushRow = () => { pushCell(); rows.push(row); row = []; if (rows.length > MAX_ROWS + 30) fail("LINHAS_LIMITE_EXCEDIDO"); };
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) { if (character === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (character === '"') { quoted = false; closed = true; } else cell += character; }
    else if (character === '"' && cell === "" && !closed) quoted = true;
    else if (character === delimiter) pushCell();
    else if (character === "\n" || character === "\r") { if (character === "\r" && text[i + 1] === "\n") i++; pushRow(); }
    else { if (closed || character === '"') fail("CSV_ASPAS_INVALIDAS"); cell += character; }
  }
  if (quoted) fail("CSV_ASPAS_INVALIDAS");
  if (cell || row.length || closed) pushRow();
  return rows;
}
async function readSheets(bytes: Buffer, fileName: string, options: ImportOptions): Promise<Sheet[]> {
  if (!bytes.length || bytes.length > importFileLimitBytes) fail("ARQUIVO_LIMITE_4_3MB");
  if (/\.csv$/i.test(fileName)) {
    let text: string; try { text = options.encoding === "latin1" ? bytes.toString("latin1") : new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("CODIFICACAO_INVALIDA"); }
    return [{ name: "CSV", rows: parseCsv(text, options.delimiter) }];
  }
  if (!/\.xlsx$/i.test(fileName)) fail("FORMATO_CSV_XLSX");
  guardWorkbook(bytes);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0], { ignoreNodes: ["drawing", "picture", "extLst", "conditionalFormatting", "dataValidations"] }); } catch { return fail("XLSX_INVALIDO"); }
  if (workbook.worksheets.length > 20) fail("ABAS_LIMITE_EXCEDIDO");
  return workbook.worksheets.map(sheet => {
    if (sheet.rowCount > MAX_ROWS + 30 || sheet.columnCount > 100) fail("PLANILHA_LIMITE_EXCEDIDO");
    const rows: Cell[][] = [];
    for (let line = 1; line <= sheet.rowCount; line++) {
      const row: Cell[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const cell = sheet.getRow(line).getCell(column); const value = cell.value;
        if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error) row.push({ text: cell.text, formula: true });
        else if (value instanceof Date) row.push({ text: Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : "", date: true });
        else if (typeof value === "number") row.push({ text: Number.isFinite(value) ? String(value) : "" });
        else row.push({ text: cell.text });
        if (row.at(-1)!.text.length > 1000) fail("CELULA_LIMITE_EXCEDIDO");
      }
      rows.push(row);
    }
    return { name: sheet.name, rows };
  });
}
function date(value: Cell, options: ImportOptions) {
  const raw = value.text.trim(); const formatted = value.date || options.dateFormat === "iso" ? raw : raw.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1");
  const parsed = new Date(`${formatted}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(formatted) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === formatted ? formatted : "";
}
export async function inspectImport(bytes: Buffer, fileName: string, options: ImportOptions): Promise<ImportInspection & { cells: Cell[][] }> {
  const sheets = await readSheets(bytes, fileName, options); const sheet = options.sheet ? sheets.find(item => item.name === options.sheet) : sheets[0];
  if (!sheet || !sheet.rows[options.headerRow - 1]) fail("ABA_CABECALHO_INVALIDO");
  const cells = sheet.rows.slice(options.headerRow); const count = cells.filter(row => row.some(cell => cell.text.trim())).length;
  if (count > MAX_ROWS || count < 1) fail("LINHAS_LIMITE_EXCEDIDO");
  return { sheets: sheets.map(item => item.name), selectedSheet: sheet.name, headers: sheet.rows[options.headerRow - 1].map((cell, index) => cell.text.trim() || `Coluna ${index + 1}`), rowCount: count,
    sample: cells.slice(0, 5).map((row, index) => ({ line: options.headerRow + index + 1, cells: row.map(cell => cell.text) })), cells };
}
export async function prepareImport(bytes: Buffer, fileName: string, kind: ImportKind, options: ImportOptions) {
  const required = kind === "clock" ? ["employeeNumber", "name"] : ["employeeNumber", "measurementDate", "effectiveFrom", "workdayHours", "balanceMinutes"];
  if (required.some(key => options.mapping[key as keyof typeof options.mapping] === undefined) || (kind === "clock" && options.mapping.cpf === undefined && options.mapping.pis === undefined)) fail("MAPEAMENTO_OBRIGATORIO");
  const mapped = Object.values(options.mapping); if (new Set(mapped).size !== mapped.length) fail("MAPEAMENTO_DUPLICADO");
  const inspection = await inspectImport(bytes, fileName, options);
  if (mapped.some(index => index! >= inspection.headers.length)) fail("MAPEAMENTO_INVALIDO");
  const rows = inspection.cells.flatMap((cells, index) => {
    if (!cells.some(cell => cell.text.trim())) return [];
    const input: Record<string, string | number> = {}; const errors: string[] = [];
    for (const [field, column] of Object.entries(options.mapping)) {
      const cell = cells[column!] ?? { text: "" }; const text = cell.text.trim();
      if (cell.formula) errors.push(`FORMULA_NAO_ACEITA_${field.toUpperCase()}`);
      input[field] = text;
      if (field === "cpf" || field === "pis") { if (text && !isStrictMonitoringIdentifier(text, field)) errors.push(`${field.toUpperCase()}_INVALIDO`); }
      if (field === "measurementDate" || field === "effectiveFrom") { input[field] = date(cell, options); if (!input[field]) errors.push(`DATA_INVALIDA_${field.toUpperCase()}`); }
      if (field === "workdayHours") { const number = Number(text.replace(",", ".")); input[field] = number; if (!/^\d+(?:[.,]\d{1,4})?$/.test(text) || number <= 0 || number > 24 || Math.round(number * 60) < 1) errors.push("JORNADA_INVALIDA"); }
      if (field === "balanceMinutes") {
        let number = NaN;
        if (options.balanceFormat === "minutes" && /^-?\d+$/.test(text)) number = Number(text);
        else if (options.balanceFormat === "decimalHours" && /^-?\d+(?:[.,]\d+)?$/.test(text)) number = Math.round(Number(text.replace(",", ".")) * 60);
        else if (options.balanceFormat === "hoursMinutes") { const match = /^(-?)(\d+):([0-5]\d)$/.exec(text); if (match) number = (Number(match[2]) * 60 + Number(match[3])) * (match[1] ? -1 : 1); }
        if (!Number.isSafeInteger(number) || Math.abs(number) > 10_000_000) errors.push("SALDO_INVALIDO");
        input[field] = Number.isFinite(number) ? number : "";
      }
    }
    if (!input.employeeNumber) errors.push("MATRICULA_OBRIGATORIA");
    return [{ line: options.headerRow + index + 1, input, errors }];
  });
  return { kind, metadata: { fileName: fileName.replace(/[\\/]/g, "_").slice(0, 200), sha256: createHash("sha256").update(bytes).digest("hex"), sheet: inspection.selectedSheet, mapping: options.mapping, dateFormat: options.dateFormat, balanceFormat: options.balanceFormat, encoding: options.encoding, headerRow: options.headerRow, delimiter: options.delimiter }, defaults: options.defaults, rows };
}
