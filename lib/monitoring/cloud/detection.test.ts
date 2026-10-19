import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { detectCloudImport } from "./detection";
const pisBase = "1234567890";
const digit = 11 - [...pisBase].reduce((sum, char, i) => sum + Number(char) * [3,2,9,8,7,6,5,4,3,2][i],0) % 11;
const PIS = pisBase + (digit > 9 ? 0 : digit);
const legacy = "0000000013" + "02102026" + "0800" + `0${PIS}` + "ABCD";
const iso = "0000000023" + "2026-10-02T08:00:00-0300" + "012345678909" + "ABCD";
describe("server import detection from original bytes", () => {
  it("detects both clock layouts without source or filename", async () => {
    expect(await detectCloudImport(Buffer.from(legacy))).toEqual({ kind: "afd", afdProfile: "legacy", afdIdentityType: "pis" });
    expect(await detectCloudImport(Buffer.from(iso))).toEqual({ kind: "afd", afdProfile: "iso", afdIdentityType: "cpf" });
  });
  it("detects CPF inside the legacy layout without routing it to the PIS clock", async () => {
    const value = legacy.replace(`0${PIS}`, "012345678909");
    expect(await detectCloudImport(Buffer.from(value))).toEqual({ kind: "afd", afdProfile: "legacy", afdIdentityType: "cpf" });
  });
  it("rejects a legacy file mixing unambiguous CPF and PIS identities", async () => {
    await expect(detectCloudImport(Buffer.from(legacy + "\n" + legacy.replace(`0${PIS}`, "012345678909")))).rejects.toThrow("CLOUD_IDENTITY_AMBIGUOUS");
  });
  it("rejects mixed, empty, binary and unrelated exports", async () => {
    for (const value of ["", "unrelated.txt", "\0" + legacy, legacy + "\n" + iso]) await expect(detectCloudImport(Buffer.from(value))).rejects.toThrow();
  });
  it.each([
    ["defense-person", ["ID", "Nome", "Grupo de pessoas", "Imagem de rosto 1"]],
    ["defense-access", ["ID", "Tipo de evento", "Eventos", "Hora", "Ponto de acesso"]],
  ] as const)("detects %s from workbook headers", async (kind, headers) => {
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Exportação").addRow([...headers]);
    expect(await detectCloudImport(Buffer.from(await workbook.xlsx.writeBuffer()))).toEqual({ kind });
  });
  it("rejects a workbook containing incompatible report types", async () => {
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Pessoas").addRow(["ID", "Nome", "Grupo de pessoas", "Imagem de rosto 1"]);
    workbook.addWorksheet("Acessos").addRow(["ID", "Tipo de evento", "Eventos", "Hora", "Ponto de acesso"]);
    await expect(detectCloudImport(Buffer.from(await workbook.xlsx.writeBuffer()))).rejects.toThrow("CLOUD_FORMAT_AMBIGUOUS");
  });
});
