import ExcelJS from "exceljs";
import { cellText, detectAfdProfile, validateWorkbookArchive } from "../ingestion/parsers.ts";
import { ImportError, normalizeLabel, normalizeIdentifier } from "../ingestion/validation.ts";

export type DetectedImport = { kind: "afd"; afdProfile: "legacy" | "iso"; afdIdentityType: "cpf" | "pis"; afdAllowAlternate?: boolean } | { kind: "defense-access" | "defense-person" };

/** Inspect the stored original, never its name or a caller supplied MIME type. */
export async function detectCloudImport(bytes: Buffer): Promise<DetectedImport> {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    validateWorkbookArchive(bytes);
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer, { ignoreNodes: ["dataValidations", "extLst"] }); }
    catch { throw new ImportError("XLSX_READ_FAILED"); }
    const kinds = new Set<"defense-access" | "defense-person">();
    for (const sheet of workbook.worksheets) {
      if (sheet.state !== "visible") continue;
      for (let line = 1; line <= Math.min(10, sheet.rowCount); line++) {
        const headers = new Set<string>();
        sheet.getRow(line).eachCell(cell => { try { headers.add(normalizeLabel(cellText(cell.value)).replace(/\*$/, "")); } catch { /* Not a valid header. */ } });
        if (["ID", "NOME", "GRUPO DE PESSOAS", "IMAGEM DE ROSTO 1"].every(key => headers.has(key))) kinds.add("defense-person");
        if (["ID", "TIPO DE EVENTO", "EVENTOS", "HORA", "PONTO DE ACESSO"].every(key => headers.has(key))) kinds.add("defense-access");
      }
    }
    if (kinds.size !== 1) throw new ImportError(kinds.size ? "CLOUD_FORMAT_AMBIGUOUS" : "XLSX_REQUIRED_HEADERS_MISSING");
    return { kind: [...kinds][0] };
  }
  const text = bytes.toString("latin1");
  if (text.includes("\0")) throw new ImportError("CLOUD_FORMAT_UNKNOWN");
  // Reject mixed layouts rather than accepting whichever happens to occur first.
  const profiles = new Set(text.split(/\r\n|\n|\r/).map(line => detectAfdProfile(line)).filter(Boolean));
  if (profiles.size !== 1) throw new ImportError(profiles.size ? "CLOUD_FORMAT_AMBIGUOUS" : "CLOUD_FORMAT_UNKNOWN");
  const afdProfile = [...profiles][0]!;
  let cpfOnly = 0; let pisOnly = 0;
  const identifiers = new Set(text.split(/\r\n|\n|\r/).filter(line => detectAfdProfile(line) === afdProfile).map(line => afdProfile === "legacy" ? line.slice(22, 34) : line.slice(34, 46)));
  for (const identifier of identifiers) {
    let cpf = false; let pis = false;
    try { normalizeIdentifier(identifier, "cpf", true); cpf = true; } catch { /* Preserve invalid rows for the parser's report. */ }
    try { normalizeIdentifier(identifier, "pis", true); pis = true; } catch { /* CPF and PIS have independent check digits. */ }
    if (cpf && !pis) cpfOnly++; if (pis && !cpf) pisOnly++;
  }
  const primary = Math.max(cpfOnly, pisOnly); const mixed = cpfOnly > 0 && pisOnly > 0;
  if (!primary || (mixed && (primary < 10 || primary / (cpfOnly + pisOnly) < 0.95))) throw new ImportError("CLOUD_IDENTITY_AMBIGUOUS");
  // A small minority may have a different valid document. The parser preserves
  // each row's document type; the database links only exact unique HR documents.
  return { kind: "afd", afdProfile, afdIdentityType: cpfOnly > pisOnly ? "cpf" : "pis", ...(mixed ? { afdAllowAlternate: true } : {}) };
}
