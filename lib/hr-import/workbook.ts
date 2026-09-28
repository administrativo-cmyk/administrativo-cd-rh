import ExcelJS from "exceljs";
import { normalizedHeader } from "./normalize.ts";

export type LocatedRow = {
  line: number;
  cell: (header: string) => ExcelJS.Cell;
};

export type LocatedTable = {
  sheet: string;
  headerRow: number;
  headers: string[];
  rows: LocatedRow[];
};

export type LoadedWorkbook = {
  workbook: ExcelJS.Workbook;
  date1904: boolean;
  table: (sheetName: string, requiredHeaders: readonly string[]) => LocatedTable;
};

function unwrap(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && "result" in value) return value.result;
  return value;
}

export function cellValue(cell: ExcelJS.Cell): unknown {
  return unwrap(cell.value);
}

export async function loadWorkbook(path: string): Promise<LoadedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);

  function table(sheetName: string, requiredHeaders: readonly string[]): LocatedTable {
    const sheet = workbook.worksheets.find((item) => normalizedHeader(item.name) === normalizedHeader(sheetName));
    if (!sheet) throw new Error(`Aba obrigatória ausente: ${sheetName}`);

    let headerRow = 0;
    let positions = new Map<string, number>();
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 30); rowNumber += 1) {
      const candidate = new Map<string, number>();
      sheet.getRow(rowNumber).eachCell((cell, column) => {
        const header = normalizedHeader(cellValue(cell));
        if (header && !candidate.has(header)) candidate.set(header, column);
      });
      if (requiredHeaders.every((header) => candidate.has(normalizedHeader(header)))) {
        headerRow = rowNumber;
        positions = candidate;
        break;
      }
    }
    if (!headerRow) throw new Error(`Cabeçalhos obrigatórios não encontrados em ${sheetName}: ${requiredHeaders.join(", ")}`);

    const rows: LocatedRow[] = [];
    for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      let nonempty = false;
      row.eachCell((cell) => { if (cellValue(cell) !== null && cellValue(cell) !== undefined && cellValue(cell) !== "") nonempty = true; });
      if (!nonempty) continue;
      rows.push({
        line: rowNumber,
        cell(header: string): ExcelJS.Cell {
          const column = positions.get(normalizedHeader(header));
          if (!column) throw new Error(`Coluna ${header} não encontrada em ${sheetName}`);
          return row.getCell(column);
        },
      });
    }
    return { sheet: sheet.name, headerRow, headers: [...positions.keys()], rows };
  }

  return { workbook, date1904: Boolean(workbook.properties.date1904), table };
}
