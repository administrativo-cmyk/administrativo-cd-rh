import ExcelJS from "exceljs";
import { cellText, detectAfdProfile, validateWorkbookArchive } from "../ingestion/parsers";
import { ImportError, normalizeLabel } from "../ingestion/validation";

export type DetectedImport = { kind: "afd"; afdProfile: "legacy" | "iso" } | { kind: "defense-access" | "defense-person" };

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
  const profiles = new Set(text.split(/\r?\n/).map(line => detectAfdProfile(line)).filter(Boolean));
  if (profiles.size !== 1) throw new ImportError(profiles.size ? "CLOUD_FORMAT_AMBIGUOUS" : "CLOUD_FORMAT_UNKNOWN");
  return { kind: "afd", afdProfile: [...profiles][0]! };
}
