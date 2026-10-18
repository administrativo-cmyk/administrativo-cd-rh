import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { inspectImport, parseCsv, prepareImport } from "./import-file";
import type { ImportOptions } from "./operations-contracts";
import { importFileLimitBytes } from "./payload-limits";
const options: ImportOptions = { headerRow: 1, delimiter: ";", encoding: "utf8", dateFormat: "iso", balanceFormat: "hoursMinutes", mapping: { employeeNumber: 0, name: 1, cpf: 2 }, defaults: { reason: "Synthetic reviewed import", sourceId: "clock", validFrom: "2026-10-17", validTo: null } };
describe("reviewed operational files", () => {
  it("preserves exact identifiers and quoted multiline CSV cells", async () => {
    const bytes = Buffer.from('Matrícula;Nome;CPF\r\n000123;"Synthetic; Person";52998224725\r\n000124;"Synthetic\nSecond";11144477735');
    const result = await prepareImport(bytes, "synthetic.csv", "clock", options);
    expect(result.rows[0]).toMatchObject({ line: 2, input: { employeeNumber: "000123", name: "Synthetic; Person", cpf: "52998224725" }, errors: [] });
    expect(result.rows[1].input.name).toBe("Synthetic\nSecond");
    expect(result.metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("does not infer columns, pad identifiers, or accept repeated mappings", async () => {
    const bytes = Buffer.from("Mat;Nome;CPF\n000123;Synthetic;123");
    await expect(prepareImport(bytes, "synthetic.csv", "clock", { ...options, mapping: {} })).rejects.toThrow("MAPEAMENTO_OBRIGATORIO");
    await expect(prepareImport(bytes, "synthetic.csv", "clock", { ...options, mapping: { employeeNumber: 0, name: 1, cpf: 1 } })).rejects.toThrow("MAPEAMENTO_DUPLICADO");
    const result = await prepareImport(bytes, "synthetic.csv", "clock", options);
    expect(result.rows[0].input.cpf).toBe("123"); expect(result.rows[0].errors).toContain("CPF_INVALIDO");
  });
  it("requires a deliberate balance unit and validates actual calendar dates", async () => {
    const bank: ImportOptions = { ...options, mapping: { employeeNumber: 0, measurementDate: 1, effectiveFrom: 2, workdayHours: 3, balanceMinutes: 4 }, dateFormat: "br" };
    const result = await prepareImport(Buffer.from("Mat;Data;Vigência;Jornada;Saldo\n000123;17/10/2026;18/10/2026;8;-12:30\n000124;31/02/2026;18/10/2026;0;12:99"), "synthetic.csv", "bank", bank);
    expect(result.rows[0].input).toMatchObject({ employeeNumber: "000123", measurementDate: "2026-10-17", effectiveFrom: "2026-10-18", workdayHours: 8, balanceMinutes: -750 });
    expect(result.rows[1].errors).toEqual(expect.arrayContaining(["DATA_INVALIDA_MEASUREMENTDATE", "JORNADA_INVALIDA", "SALDO_INVALIDO"]));
    const decimal = await prepareImport(Buffer.from("Mat;Data;Vigência;Jornada;Saldo\n000123;17/10/2026;18/10/2026;8;-12,5"), "synthetic.csv", "bank", { ...bank, balanceFormat: "decimalHours" });
    expect(decimal.rows[0].input.balanceMinutes).toBe(-750);
  });
  it("reads XLSX selected sheet and rejects formulas for identity fields", async () => {
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("ignored").addRows([["x"], ["y"]]); const sheet = workbook.addWorksheet("Cadastro");
    sheet.addRows([["Mat", "Nome", "CPF"], ["000123", "Synthetic", { formula: '"52998224725"', result: "52998224725" }]]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const inspected = await inspectImport(bytes, "synthetic.xlsx", { ...options, sheet: "Cadastro" });
    expect(inspected.headers).toEqual(["Mat", "Nome", "CPF"]);
    const result = await prepareImport(bytes, "synthetic.xlsx", "clock", { ...options, sheet: "Cadastro" });
    expect(result.rows[0].errors).toContain("FORMULA_NAO_ACEITA_CPF");
  });
  it("bounds bytes, archive expansion, rows, columns, cells and malformed CSV", async () => {
    await expect(inspectImport(Buffer.alloc(importFileLimitBytes + 1), "synthetic.csv", options)).rejects.toThrow("ARQUIVO_LIMITE_4_3MB");
    expect(() => parseCsv('a;"unterminated', ";")).toThrow("CSV_ASPAS_INVALIDAS");
    expect(() => parseCsv("a".repeat(1001), ";")).toThrow("CELULA_LIMITE_EXCEDIDO");
    expect(() => parseCsv(Array(101).fill("a").join(";"), ";")).toThrow("COLUNAS_LIMITE_EXCEDIDO");
    await expect(inspectImport(Buffer.from(Array(2002).fill("a").join("\n")), "synthetic.csv", options)).rejects.toThrow("LINHAS_LIMITE_EXCEDIDO");
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Data").addRows([["a"], ["b"]]); const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); bytes.writeUInt32LE(50 * 1024 * 1024, central + 24);
    await expect(inspectImport(bytes, "synthetic.xlsx", options)).rejects.toThrow("XLSX_LIMITE_EXCEDIDO");
  });
});
