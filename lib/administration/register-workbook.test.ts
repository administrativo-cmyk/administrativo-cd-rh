import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createRegisterWorkbook, previewRegisterWorkbook } from "./register-workbook";
import { validateWorkbookOperation } from "./register-workbook-contracts";

const employeeId = "ad000001-0000-4000-8000-000000000001";
const unitId = "ad000002-0000-4000-8000-000000000001";
const otherUnitId = "ad000002-0000-4000-8000-000000000002";
const measurementId = "ad000003-0000-4000-8000-000000000001";
const version = "2026-11-12T14:05:00.004Z";
const meta = { createdAt: version, updatedAt: version };
const units = [
  { id: unitId, code: "001", name: "Unidade 1", active: true, ...meta },
  { id: otherUnitId, code: "002", name: "Unidade 2", active: true, ...meta },
];
const options = {
  units, managers: [], catalogs: [],
  employees: [{ id: employeeId, employeeNumber: "0042", name: "Pessoa Sintética", unitId, managerId: null, activeInSystem: true }],
};

async function fixture() {
  const file = await createRegisterWorkbook({
    options,
    registers: {
      employee: [{
        ...options.employees[0], ...meta, additionalEmployeeNumbers: ["0030"], cpf: "01234567890", pis: null,
        situation: "ATIVO", gender: null, department: null, role: null, category: null,
        admissionDate: "2026-02-01", movement: null, workdayHours: 7.3333, observation: null,
        terminationDate: null, situationFrom: null, expectedReturnDate: null,
      }],
      unit: units, manager: [], vacation: [], department: [], job: [], category: [],
    },
    bank: [{
      id: measurementId, employeeId, employeeName: "Pessoa Sintética", employeeNumber: "0042", unit: "001",
      measurementDate: "2026-11-10", effectiveFrom: "2026-11-11", workdayHours: 7.3333, balanceMinutes: -125,
      source: "Extrato", importBatchId: null, cancelledAt: null, ...meta,
    }],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return { file, workbook };
}

describe("Excel de atualização do RH", () => {
  it("exporta todos os cadastros, listas do sistema e identificadores em texto", async () => {
    const { file, workbook } = await fixture();
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      "Quadro Atual", "Banco de Horas", "Férias", "Unidades", "Gestores", "Setores", "Cargos e Funções", "Categorias", "Como usar", "Opcoes",
    ]);
    const quadro = workbook.getWorksheet("Quadro Atual")!;
    expect(quadro.getCell("A2").value).toBe("0042");
    expect(quadro.getCell("J2").value).toBe("01234567890");
    expect(quadro.getCell("C2").dataValidation).toMatchObject({ type: "list", formulae: ["RH_units"] });
    expect(workbook.definedNames.getRanges("RH_units").ranges).toEqual(["Opcoes!$A$2:$A$3"]);
    expect(workbook.getWorksheet("Opcoes")?.state).toBe("veryHidden");
    expect(await previewRegisterWorkbook(file, options)).toEqual({ changes: [], issues: [], unchanged: 4 });
  });

  it("resolve a lista suspensa e preserva o zero no saldo e a versão original", async () => {
    const { workbook } = await fixture();
    const quadro = workbook.getWorksheet("Quadro Atual")!;
    quadro.getCell("C2").value = "002 · Unidade 2";
    quadro.getCell("J2").value = null;
    quadro.getCell("M2").value = "02/02/2026";
    workbook.getWorksheet("Banco de Horas")!.getCell("F2").value = 0;
    const preview = await previewRegisterWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), options);
    expect(preview.issues).toEqual([]);
    expect(preview.unchanged).toBe(2);
    expect(preview.changes).toMatchObject([
      { entity: "employee", line: 2, fields: ["Unidade", "CPF", "Admissão"], data: { id: employeeId, expectedUpdatedAt: version, unitId: otherUnitId, employeeNumber: "0042", cpf: null, admissionDate: "2026-02-02" } },
      { entity: "bank", line: 2, fields: ["Saldo medido (min)"], data: { id: measurementId, expectedUpdatedAt: version, employeeId, balanceMinutes: 0 } },
    ]);
    expect(validateWorkbookOperation(preview.changes[1], "Extrato conferido")).toMatchObject({ balanceMinutes: 0, reason: "Extrato conferido" });
  });

  it("recusa fórmulas, referências inválidas e alteração do titular da medição", async () => {
    const { workbook } = await fixture();
    workbook.getWorksheet("Quadro Atual")!.getCell("C2").value = "Unidade não cadastrada";
    workbook.getWorksheet("Banco de Horas")!.getCell("B2").value = "Outra pessoa";
    workbook.getWorksheet("Unidades")!.getCell("B2").value = { formula: "1+1", result: 2 };
    const preview = await previewRegisterWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), options);
    expect(preview.changes).toEqual([]);
    expect(preview.issues).toMatchObject([
      { sheet: "Quadro Atual", line: 2, message: expect.stringContaining("opção vigente") },
      { sheet: "Banco de Horas", line: 2, message: expect.stringContaining("identifica a medição") },
      { sheet: "Unidades", line: 2, message: expect.stringContaining("sem fórmulas") },
    ]);
  });
});
