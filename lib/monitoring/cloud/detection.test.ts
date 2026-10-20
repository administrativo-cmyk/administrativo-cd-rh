import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { detectAfdEncoding, detectCloudImport } from "./detection";
import { parseAfd } from "../ingestion/parsers";
const pisBase = "1234567890";
const digit = 11 - [...pisBase].reduce((sum, char, i) => sum + Number(char) * [3,2,9,8,7,6,5,4,3,2][i],0) % 11;
const PIS = pisBase + (digit > 9 ? 0 : digit);
const legacy = "0000000013" + "02102026" + "0800" + `0${PIS}` + "ABCD";
const iso = "0000000023" + "2026-10-02T08:00:00-0300" + "012345678909" + "ABCD";
describe("server import detection from original bytes", () => {
  it("detects Latin-1 independently of ISO timestamps and preserves the original bytes", async () => {
    const bytes = Buffer.from("0000000001Exportação do relógio\r\n" + iso, "latin1");
    const detected = await detectCloudImport(bytes);
    expect(detected).toMatchObject({ kind: "afd", afdProfile: "iso", afdIdentityType: "cpf" });
    expect(detectAfdEncoding(bytes)).toBe("latin1");
    const parsed = parseAfd(bytes, { id: "clock", kind: "afd", root: "", timeZone: "America/Sao_Paulo", encoding: detectAfdEncoding(bytes), afdProfile: "iso" });
    expect(parsed.occurrences[0].original.record).toContain("Exportação");
    expect(parsed.occurrences[1].event?.identity?.type).toBe("cpf");
    expect(parsed.byteLength).toBe(bytes.length);
    expect(detectAfdEncoding(Buffer.from("Exportação\n" + iso, "utf8"))).toBe("utf8");
    expect(() => detectAfdEncoding(Buffer.from("\0" + iso))).toThrow("INVALID_FILE_ENCODING");
  });
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
  it("recognizes a PIS clock with a small CPF minority without dropping the minority's document type", async () => {
    const records: string[] = [];
    for (let i = 0; i < 30; i++) {
      const base = String(1111100000 + i); const check = 11 - [...base].reduce((sum, digit, index) => sum + Number(digit) * [3,2,9,8,7,6,5,4,3,2][index], 0) % 11;
      records.push(legacy.replace(`0${PIS}`, `0${base}${check > 9 ? 0 : check}`));
    }
    records.push(legacy.replace(`0${PIS}`, "012345678909"));
    expect(await detectCloudImport(Buffer.from(records.join("\r\n")))).toEqual({kind:"afd",afdProfile:"legacy",afdIdentityType:"pis",afdAllowAlternate:true});
  });
  it("rejects mixed, empty, binary and unrelated exports", async () => {
    for (const value of ["", "unrelated.txt", "\0" + legacy, legacy + "\n" + iso, legacy + "\r" + iso]) await expect(detectCloudImport(Buffer.from(value))).rejects.toThrow();
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
