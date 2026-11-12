import ExcelJS, { type Cell, type DataValidation, type Worksheet } from "exceljs";
import { z } from "zod";
import type { AdministrationRows, AdministrationSnapshot } from "./contracts";
import type { BankMeasurement } from "@/lib/time-bank-admin/contracts";
import { situationLabels } from "@/lib/workforce";
import { validDate } from "@/lib/data/daily-call-dates";
import { guardWorkbook } from "@/lib/monitoring/import-file";
import { validateWorkbookOperation, type RegisterWorkbookEntity, type RegisterWorkbookPreview } from "./register-workbook-contracts";

type Options = AdministrationSnapshot["options"];
type FieldValue = string | number | null;
type Choice = "units" | "managers" | "employees" | "department" | "job" | "category" | "gender" | "situation" | "vacationStatus";
type Column = { key: string; title: string; kind?: "number" | "date" | "lines"; choice?: Choice; readOnly?: boolean; width?: number };
type Sheet = { entity: RegisterWorkbookEntity; name: string; columns: Column[] };
type WorkbookData = { registers: { [E in keyof AdministrationRows]: AdministrationRows[E][] }; bank: BankMeasurement[]; options: Options };
type WorksheetWithValidation = Worksheet & { dataValidations: { add(range: string, validation: DataValidation): void } };

const nameColumn = { key: "name", title: "Nome", width: 35 };
const workbookSheets: Sheet[] = [
  { entity: "employee", name: "Quadro Atual", columns: [
    { key: "employeeNumber", title: "Matrícula", width: 15 },
    { ...nameColumn, title: "Nome completo" },
    { key: "unitId", title: "Unidade", choice: "units", width: 29 },
    { key: "managerId", title: "Gestor", choice: "managers", width: 32 },
    { key: "department", title: "Setor", choice: "department", width: 26 },
    { key: "role", title: "Cargo ou função", choice: "job", width: 28 },
    { key: "category", title: "Categoria", choice: "category" },
    { key: "situation", title: "Situação", choice: "situation", width: 23 },
    { key: "gender", title: "Gênero", choice: "gender" },
    { key: "cpf", title: "CPF" },
    { key: "pis", title: "PIS" },
    { key: "additionalEmployeeNumbers", title: "Outras matrículas", kind: "lines", width: 23 },
    { key: "admissionDate", title: "Admissão", kind: "date" },
    { key: "workdayHours", title: "Jornada diária (h)", kind: "number" },
    { key: "movement", title: "Movimento" },
    { key: "terminationDate", title: "Desligamento", kind: "date" },
    { key: "situationFrom", title: "Situação desde", kind: "date" },
    { key: "expectedReturnDate", title: "Retorno previsto", kind: "date" },
    { key: "observation", title: "Observação", width: 42 },
  ] },
  { entity: "bank", name: "Banco de Horas", columns: [
    { key: "employeeNumber", title: "Matrícula", readOnly: true, width: 15 },
    { key: "employeeName", title: "Colaborador", readOnly: true, width: 35 },
    { key: "measurementDate", title: "Data da medição", kind: "date" },
    { key: "effectiveFrom", title: "Início da vigência", kind: "date" },
    { key: "workdayHours", title: "Jornada diária (h)", kind: "number" },
    { key: "balanceMinutes", title: "Saldo medido (min)", kind: "number" },
    { key: "source", title: "Origem", width: 32 },
  ] },
  { entity: "vacation", name: "Férias", columns: [
    { key: "employeeId", title: "Colaborador", choice: "employees", width: 50 },
    { key: "startDate", title: "Início das férias", kind: "date" },
    { key: "endDate", title: "Fim das férias", kind: "date" },
    { key: "acquisitionStart", title: "Início aquisitivo", kind: "date" },
    { key: "acquisitionEnd", title: "Fim aquisitivo", kind: "date" },
    { key: "status", title: "Etapa", choice: "vacationStatus" },
    { key: "observation", title: "Observação", width: 42 },
  ] },
  { entity: "unit", name: "Unidades", columns: [{ key: "code", title: "Código" }, nameColumn] },
  { entity: "manager", name: "Gestores", columns: [nameColumn, { key: "referenceUnitId", title: "Unidade de referência", choice: "units", width: 34 }] },
  { entity: "department", name: "Setores", columns: [nameColumn] },
  { entity: "job", name: "Cargos e Funções", columns: [nameColumn] },
  { entity: "category", name: "Categorias", columns: [nameColumn] },
];
const metadataHeadings = ["RH Conect v1 · ID", "Versão", "Valores originais", "ID do colaborador"];
export const maxWorkbookRows = 12000;
const rowId = z.string().uuid();
const rowVersion = z.string().datetime({ offset: true });
const originalSchema = z.array(z.union([z.string().max(4000), z.number(), z.null()]));

function labeledIds(items: { value: string; label: string }[]) {
  const counts = new Map<string, number>();
  for (const { label } of items) counts.set(label, (counts.get(label) ?? 0) + 1);
  return new Map(items.map(({ value, label }) => [value, counts.get(label) === 1 ? label : label + " · " + value]));
}

function choices(options: Options): Record<Choice, Map<string, string>> {
  const catalog = (kind: Choice) => new Map((options.catalogs ?? []).filter(item => item.kind === kind && item.active).map(item => [item.name, item.name]));
  return {
    units: labeledIds(options.units.filter(item => item.active).map(item => ({ value: item.id, label: item.code + " · " + item.name }))),
    managers: labeledIds(options.managers.filter(item => item.active).map(item => ({ value: item.id, label: item.name }))),
    employees: labeledIds(options.employees.filter(item => item.activeInSystem).map(item => ({ value: item.id, label: item.employeeNumber + " · " + item.name }))),
    department: catalog("department"), job: catalog("job"), category: catalog("category"),
    gender: new Map([["feminino", "Feminino"], ["masculino", "Masculino"]]),
    situation: new Map(Object.entries(situationLabels)),
    vacationStatus: new Map([["draft", "Rascunho"], ["requested", "Solicitado"], ["approved", "Aprovado"], ["cancelled", "Cancelado"]]),
  };
}

function heading(sheet: Worksheet, labels: string[]) {
  const header = sheet.addRow(labels);
  header.height = 26;
  header.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF193956" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle" };
  });
}

function spreadsheetValue(column: Column, value: unknown, lists: ReturnType<typeof choices>): FieldValue {
  if (value === null || value === undefined || value === "") return null;
  if (column.choice) return lists[column.choice].get(String(value)) ?? String(value);
  if (Array.isArray(value)) return value.length ? value.join("\n") : null;
  return typeof value === "number" ? value : String(value).trim() || null;
}

export async function createRegisterWorkbook(data: WorkbookData) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RH Conect";
  const lists = choices(data.options);
  for (const { entity, name, columns } of workbookSheets) {
    const records = entity === "bank" ? data.bank : data.registers[entity];
    if (records.length > maxWorkbookRows) throw new Error("A aba " + name + " excede o limite de 12.000 registros.");
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
    heading(sheet, [...columns.map(column => column.title), ...metadataHeadings]);
    for (const [index, column] of columns.entries()) {
      const excelColumn = sheet.getColumn(index + 1);
      excelColumn.width = column.width ?? 21;
      if (!column.kind || column.kind === "lines") excelColumn.numFmt = "@";
      if (column.kind === "date") excelColumn.numFmt = "dd/mm/yyyy";
    }
    for (let offset = 1; offset <= metadataHeadings.length; offset++) sheet.getColumn(columns.length + offset).hidden = true;
    for (const record of records) {
      const source = record as unknown as Record<string, unknown>;
      const values = columns.map(column => spreadsheetValue(column, source[column.key], lists));
      const cells = values.map((value, index) => value && columns[index].kind === "date" ? new Date(value + "T00:00:00Z") : value);
      const row = sheet.addRow([...cells, record.id, record.updatedAt, JSON.stringify(values), entity === "bank" ? source.employeeId : null]);
      for (const [index, column] of columns.entries()) {
        const cell = row.getCell(index + 1);
        if (column.readOnly) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EEF4" } };
        }
        if (column.kind === "lines") cell.alignment = { vertical: "middle", wrapText: true };
      }
    }
    for (const [index, column] of columns.entries()) {
      if (!column.choice || !lists[column.choice].size || sheet.rowCount < 2) continue;
      const range = sheet.getCell(2, index + 1).address + ":" + sheet.getCell(sheet.rowCount, index + 1).address;
      (sheet as WorksheetWithValidation).dataValidations.add(range, {
        type: "list", allowBlank: true, showErrorMessage: true, errorStyle: "stop",
        errorTitle: "Opção inválida", error: "Selecione uma opção da lista.", formulae: ["RH_" + column.choice],
      });
    }
    // Sorting through the filter must carry the row's hidden ID and version.
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: columns.length + metadataHeadings.length } };
  }

  const guide = workbook.addWorksheet("Como usar");
  guide.getColumn(1).width = 110;
  heading(guide, ["Atualização de dados do RH Conect"]);
  [
    "Edite as linhas existentes. Se ordenar, use o filtro do cabeçalho para mover a linha inteira.",
    "Preserve os nomes das abas, os títulos e as colunas ocultas.",
    "Quadro Atual também atualiza o cadastro de colaboradores. Use as listas suspensas nos campos com opções.",
    "Preserve matrícula, CPF e PIS como texto. Datas podem ser digitadas como DD/MM/AAAA.",
    "Cadastros em afastamento exigem início da situação e retorno previsto ao atualizar.",
    "Banco de Horas usa saldo medido em minutos inteiros. A coluna Colaborador identifica a medição.",
    "Limpar um campo opcional remove seu valor. Excluir linhas não exclui registros no sistema.",
    "Envie o mesmo Excel, confira a prévia e informe o motivo para aplicar. Baixe uma nova cópia após atualizar.",
    "O arquivo contém dados pessoais de acesso restrito ao RH.",
  ].forEach(line => { const row = guide.addRow([line]); row.height = 27; row.getCell(1).alignment = { wrapText: true, vertical: "middle" }; });

  const options = workbook.addWorksheet("Opcoes", { state: "veryHidden" });
  for (const [index, [key, entries]] of Object.entries(lists).entries()) {
    options.getCell(1, index + 1).value = key;
    Array.from(entries.values()).forEach((value, offset) => { options.getCell(offset + 2, index + 1).value = value; });
    if (entries.size) workbook.definedNames.add("Opcoes!" + options.getCell(2, index + 1).address + ":" + options.getCell(entries.size + 1, index + 1).address, "RH_" + key);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function readValue(cell: Cell, column: Column): FieldValue {
  const { value } = cell;
  if (value === null || value === undefined || value === "") return null;
  if (column.kind === "date") {
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim().replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1");
    if (!validDate(text)) throw new Error(column.title + ": informe uma data válida.");
    return text;
  }
  if (column.kind === "number") {
    const text = String(value).trim().replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) throw new Error(column.title + ": informe um número válido.");
    return Number(text);
  }
  if (typeof value !== "string" || value.length > 4000) throw new Error(column.title + ": informe texto sem fórmulas.");
  return value.trim() || null;
}

export async function previewRegisterWorkbook(bytes: Buffer, options: Options): Promise<RegisterWorkbookPreview> {
  guardWorkbook(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0], { ignoreNodes: ["drawing", "picture", "extLst", "conditionalFormatting", "dataValidations"] });
  const labels = new Map(Object.entries(choices(options)).map(([key, items]) => [key, new Map(Array.from(items, ([value, label]) => [label, value]))]));
  const result: RegisterWorkbookPreview = { changes: [], issues: [], unchanged: 0 };
  for (const { entity, name, columns } of workbookSheets) {
    const sheet = workbook.getWorksheet(name);
    const expectedHeadings = [...columns.map(column => column.title), ...metadataHeadings];
    if (!sheet || expectedHeadings.some((title, index) => sheet.getCell(1, index + 1).value !== title)) throw new Error("A aba " + name + " deve manter os títulos do Excel exportado.");
    if (sheet.rowCount > maxWorkbookRows + 1 || sheet.columnCount > expectedHeadings.length) throw new Error("A aba " + name + " excede a estrutura do Excel exportado.");
    const seen = new Set<string>();
    sheet.eachRow((row, line) => {
      if (line === 1) return;
      try {
        const id = rowId.parse(row.getCell(columns.length + 1).value);
        const expectedUpdatedAt = rowVersion.parse(row.getCell(columns.length + 2).value);
        if (seen.has(id)) throw new Error("Registro duplicado na planilha.");
        seen.add(id);
        const original = originalSchema.parse(JSON.parse(String(row.getCell(columns.length + 3).value)));
        if (original.length !== columns.length) throw new Error("Os dados originais da linha foram alterados.");
        const values = columns.map((column, index) => readValue(row.getCell(index + 1), column));
        const changes = columns.filter((_, index) => values[index] !== original[index]);
        if (!changes.length) { result.unchanged++; return; }
        const data: Record<string, unknown> = { id, expectedUpdatedAt };
        if (entity === "bank") data.employeeId = rowId.parse(row.getCell(columns.length + 4).value);
        for (const [index, column] of columns.entries()) {
          const value = values[index];
          if (entity === "employee" && ["cpf", "pis", "additionalEmployeeNumbers"].includes(column.key) && !changes.includes(column)) continue;
          if (column.readOnly) {
            if (changes.includes(column)) throw new Error(column.title + " identifica a medição e deve permanecer igual.");
            continue;
          }
          if (column.choice && value !== null) {
            const selected = labels.get(column.choice)?.get(String(value));
            if (!selected) throw new Error(column.title + ": selecione uma opção vigente do sistema.");
            data[column.key] = selected;
          } else if (column.kind === "lines") data[column.key] = typeof value === "string" ? value.split(/[\n,;]+/).map(item => item.trim()).filter(Boolean) : [];
          else data[column.key] = value;
        }
        const operation = { entity, line, data };
        validateWorkbookOperation(operation, "Revisão por planilha");
        const label = String(data.name ?? data.employeeNumber ?? data.code ?? values[1] ?? values[0] ?? "Registro");
        result.changes.push({ ...operation, label, fields: changes.map(column => column.title) });
      } catch (error) {
        const message = error instanceof z.ZodError ? error.issues.map(issue => {
          const field = columns.find(column => column.key === issue.path[0]);
          return field ? field.title + ": " + issue.message : "Confira os campos e a identificação original da linha.";
        }).join(" · ") : error instanceof Error && !(error instanceof SyntaxError) ? error.message : "Use uma linha existente do Excel exportado.";
        result.issues.push({ sheet: name, line, message });
      }
    });
  }
  return result;
}
