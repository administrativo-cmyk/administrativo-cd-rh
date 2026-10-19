import ExcelJS from "exceljs";
import { inflateRawSync } from "node:zlib";
import { ImportError, errorCode, normalizeIdentifier, normalizeLabel, parseLocalTimestamp, parseOffsetTimestamp, sha256, stableHash } from "./validation.ts";
import type { AfdProfile, CanonicalImportEvent, EventClassification, ImportOccurrence, IngestionSource, ParsedImport } from "./types.ts";

const VERSION = "monitoring-import/1.0.0";
/** Frozen by the server when a cloud job is created; never supplied by a browser. */
export function ingestionParserVersion(source: Pick<IngestionSource, "kind" | "afdProfile" | "afdIdentityType" | "afdAllowAlternate">): string {
  if (source.kind === "afd") {
    if (source.afdProfile !== "legacy" && source.afdProfile !== "iso") throw new ImportError("INVALID_AFD_PROFILE");
    const defaultIdentity = source.afdProfile === "legacy" ? "pis" : "cpf";
    return `${VERSION}/afd-${source.afdProfile}${source.afdIdentityType && source.afdIdentityType !== defaultIdentity ? `-${source.afdIdentityType}` : ""}${source.afdAllowAlternate ? "-alternate" : ""}`;
  }
  if (source.kind !== "defense-access" && source.kind !== "defense-person") throw new ImportError("INVALID_SOURCE_CONFIG");
  return `${VERSION}/${source.kind}`;
}
const MAX_ROWS = 500_000;
const recordIssue = (code: string, line?: number) => ({ code, severity: "error" as const, ...(line ? { line } : {}) });
function result(bytes: Buffer, source: IngestionSource): ParsedImport {
  return { parserVersion: VERSION, sourceId: source.id, sha256: sha256(bytes), byteLength: bytes.length, totalRows: 0, occurrences: [], issues: [], observedRange: null, metadata: {} };
}
function updateRange(parsed: ParsedImport, timestamp: string) {
  if (!parsed.observedRange) parsed.observedRange = { from: timestamp, to: timestamp };
  else { if (timestamp < parsed.observedRange.from) parsed.observedRange.from = timestamp; if (timestamp > parsed.observedRange.to) parsed.observedRange.to = timestamp; }
}
function occurrence(parsed: ParsedImport, line: number, original: Record<string, string>, sheet?: string): ImportOccurrence {
  return { key: stableHash([parsed.sourceId, parsed.sha256, sheet ?? "", line]), line, sheet, original, payloadHash: stableHash(original), issues: [] };
}

export function detectAfdProfile(text: string): AfdProfile | null {
  for (const line of text.split(/\r\n|\n|\r/)) {
    if (/^\d{9}3\d{8}\d{4}\d{12}[\da-fA-F]{4}$/.test(line)) return "legacy";
    if (/^\d{9}3\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}\d{12}[\da-fA-F]{4}$/.test(line)) return "iso";
  }
  return null;
}

export function parseAfd(bytes: Buffer, source: IngestionSource): ParsedImport {
  const parsed = result(bytes, source);
  let text: string;
  try { text = source.encoding === "latin1" ? bytes.toString("latin1") : new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ImportError("INVALID_FILE_ENCODING"); }
  if (text.includes("\u0000")) throw new ImportError("INVALID_FILE_ENCODING");
  const profile = detectAfdProfile(text);
  if (!profile) throw new ImportError("AFD_PROFILE_UNRECOGNIZED");
  if (source.afdProfile && source.afdProfile !== profile) { parsed.skipped = true; return parsed; }
  parsed.parserVersion = ingestionParserVersion({ ...source, afdProfile: profile });
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > MAX_ROWS) throw new ImportError("TOO_MANY_ROWS");
  const lastRecord = lines.findLast(line => line.trim() !== "");
  if (lastRecord?.[9] === "3" && lastRecord.length < (profile === "legacy" ? 38 : 50)) throw new ImportError("AFD_INCOMPLETE_LAST_RECORD");
  let header = false; let trailer = false; let punches = 0;
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    if (!raw.trim()) continue;
    parsed.totalRows++;
    const row = occurrence(parsed, index + 1, { record: raw });
    parsed.occurrences.push(row);
    const type = raw[9];
    if (type === "1") { header = true; continue; }
    if (/^999999999/.test(raw)) { trailer = true; continue; }
    if (type === "5" || type === "6") { row.issues.push({ code: "AFD_NON_PUNCH_RECORD_PRESERVED", severity: "warning", line: index + 1 }); continue; }
    if (type !== "3") { row.issues.push(recordIssue("AFD_UNSUPPORTED_RECORD", index + 1)); continue; }
    try {
      if (!/^\d{9}/.test(raw) || raw.length !== (profile === "legacy" ? 38 : 50) || !/^[\da-f]{4}$/i.test(raw.slice(-4))) throw new ImportError("AFD_INVALID_RECORD_LENGTH_OR_CRC_FORMAT");
      const nsr = raw.slice(0, 9);
      const rawIdentifier = profile === "legacy" ? raw.slice(22, 34) : raw.slice(34, 46);
      let identityType = source.afdIdentityType ?? (profile === "legacy" ? "pis" : "cpf");
      let value: string;
      try { value = normalizeIdentifier(rawIdentifier, identityType, true); } catch (error) {
        if (!source.afdAllowAlternate) throw error;
        identityType = identityType === "cpf" ? "pis" : "cpf";
        value = normalizeIdentifier(rawIdentifier, identityType, true);
      }
      const rawTimestamp = profile === "legacy" ? `${raw.slice(10, 18)}${raw.slice(18, 22)}` : raw.slice(10, 34);
      const timestamp = profile === "legacy"
        ? parseLocalTimestamp(`${raw.slice(14, 18)}-${raw.slice(12, 14)}-${raw.slice(10, 12)} ${raw.slice(18, 20)}:${raw.slice(20, 22)}:00`, source.timeZone)
        : parseOffsetTimestamp(rawTimestamp);
      row.event = { key: stableHash(["afd", source.id, nsr]), type: "punch", identity: { type: identityType, value }, timestamp, device: source.id, classification: "authorized", eligible: true, rawTimestamp, rawIdentifier, nsr, precisionSeconds: profile === "legacy" ? 60 : 1, original: { record: raw, crc: raw.slice(-4), profile }, checksumStatus: "not_verified", evidence: "punch_record" };
      row.issues.push({ code: "AFD_CHECKSUM_NOT_VERIFIED", severity: "warning", line: index + 1 });
      updateRange(parsed, timestamp); punches++;
    } catch (error) { row.issues.push(recordIssue(errorCode(error), index + 1)); }
  }
  if (!header) parsed.issues.push({ code: "AFD_HEADER_ABSENT_LAYOUT_UNCONFIRMED", severity: "warning" });
  if (!trailer) parsed.issues.push({ code: "AFD_TRAILER_ABSENT_PARTIAL_EXPORT", severity: "warning" });
  if (!source.sourceIdentityConfirmed) parsed.issues.push({ code: "SOURCE_DEVICE_IDENTITY_UNCONFIRMED", severity: "warning" });
  parsed.metadata = { profile, identityType: source.afdIdentityType ?? (profile === "legacy" ? "pis" : "cpf"), header, trailer, punches, checksumStatus: "not_verified" };
  return parsed;
}

/** Inspect the ZIP directory before ExcelJS expands XML; declared dimensions are not trusted. */
export function validateWorkbookArchive(bytes: Buffer, maxExpandedBytes = 256 * 1024 * 1024): void {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) throw new ImportError("INVALID_XLSX_ARCHIVE");
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { eocd = offset; break; }
  }
  if (eocd < 0) throw new ImportError("XLSX_INCOMPLETE_ARCHIVE");
  const count = bytes.readUInt16LE(eocd + 10); const start = bytes.readUInt32LE(eocd + 16); const directorySize = bytes.readUInt32LE(eocd + 12);
  if (bytes.readUInt16LE(eocd + 4) || bytes.readUInt16LE(eocd + 6) || count === 0xffff || count > 10_000 || start + directorySize > eocd) throw new ImportError("XLSX_ARCHIVE_LIMIT");
  let offset = start; let expanded = 0; const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > eocd || bytes.readUInt32LE(offset) !== 0x02014b50) throw new ImportError("INVALID_XLSX_DIRECTORY");
    const flags = bytes.readUInt16LE(offset + 8); const method = bytes.readUInt16LE(offset + 10); const compressed = bytes.readUInt32LE(offset + 20); const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28); const extra = bytes.readUInt16LE(offset + 30); const comment = bytes.readUInt16LE(offset + 32); const localOffset = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extra + comment;
    if (next > eocd || flags & 1 || ![0, 8].includes(method) || localOffset + 30 > start) throw new ImportError("UNSUPPORTED_XLSX_ENTRY");
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (names.has(name) || name.includes("..") || /^[\/\\]/.test(name) || name.includes("\\") || /vbaProject\.bin$/i.test(name)) throw new ImportError("UNSAFE_XLSX_ENTRY");
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new ImportError("INVALID_XLSX_ENTRY");
    const localData = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    if (localData + compressed > start) throw new ImportError("XLSX_INCOMPLETE_ARCHIVE");
    expanded += size;
    if (size > 128 * 1024 * 1024 || expanded > maxExpandedBytes || (size > 1024 * 1024 && size / Math.max(compressed, 1) > 1000)) throw new ImportError("XLSX_EXPANSION_LIMIT");
    // Central-directory sizes are attacker-controlled. Bound the actual expansion too.
    try {
      const packed = bytes.subarray(localData, localData + compressed);
      const unpacked = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, Math.min(128 * 1024 * 1024, maxExpandedBytes - expanded + size)) });
      if (unpacked.length !== size) throw new ImportError("XLSX_ENTRY_SIZE_MISMATCH");
    } catch (error) { if (error instanceof ImportError) throw error; throw new ImportError("XLSX_EXPANSION_OR_COMPRESSION_INVALID"); }
    names.add(name); offset = next;
  }
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml") || offset !== start + directorySize) throw new ImportError("INVALID_XLSX_STRUCTURE");
}

export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) throw new ImportError("UNSAFE_NUMERIC_CELL"); return String(value); }
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if ("formula" in value || "sharedFormula" in value) throw new ImportError("FORMULA_CELL_NOT_ACCEPTED");
  if ("richText" in value) return value.richText.map(part => part.text).join("").trim();
  if ("text" in value) return String(value.text).trim();
  throw new ImportError("UNSUPPORTED_CELL_VALUE");
}
export function photoReference(value: ExcelJS.CellValue): string | null {
  if (!value) return null;
  if (typeof value === "object" && "hyperlink" in value) return String(value.hyperlink).trim() || null;
  return cellText(value) || null;
}

export function classifyAccess(eventName: string, eventType: string, identity: string | null): EventClassification {
  const event = normalizeLabel(`${eventName} ${eventType}`);
  if (/ALARME|ANTI[- ]?PASSBACK/.test(event)) return "alarm";
  if (/ERRO|NEGAD|RECUSAD|INVALID|ROSTO ESTRANHO|ESTRANHO \(ROSTO\)|FORA DO PERIODO/.test(event)) return "denied";
  if (!identity || /BOTAO|REMOT|PLATAFORMA/.test(event)) return "anonymous";
  if (normalizeLabel(eventName) === "DESBLOQUEIO POR ROSTO") return "authorized";
  return "unknown";
}

export async function parseWorkbook(bytes: Buffer, source: IngestionSource): Promise<ParsedImport> {
  validateWorkbookArchive(bytes);
  const parsed = result(bytes, source);
  parsed.parserVersion = `${VERSION}/${source.kind}`;
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer, { ignoreNodes: ["dataValidations", "extLst"] }); }
  catch { throw new ImportError("XLSX_READ_FAILED"); }
  const required = source.kind === "defense-person" ? ["ID", "NOME", "GRUPO DE PESSOAS", "IMAGEM DE ROSTO 1"] : ["TIPO DE EVENTO", "EVENTOS", "HORA", "PONTO DE ACESSO", "ID"];
  let found = 0; const frequencies = new Map<string, number>();
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== "visible") continue;
    let headerRow = 0; let columns = new Map<string, number>();
    for (let line = 1; line <= Math.min(10, sheet.rowCount); line++) {
      const candidate = new Map<string, number>();
      sheet.getRow(line).eachCell((cell, column) => { try { candidate.set(normalizeLabel(cellText(cell.value)).replace(/\*$/, ""), column); } catch { /* Invalid header cannot match required columns. */ } });
      if (required.every(key => candidate.has(key))) { headerRow = line; columns = candidate; break; }
    }
    if (!headerRow) continue;
    found++;
    if (sheet.rowCount > MAX_ROWS) throw new ImportError("TOO_MANY_ROWS");
    sheet.eachRow({ includeEmpty: false }, (excelRow, line) => {
      if (line <= headerRow) return;
      const read = (name: string) => columns.has(name) ? cellText(excelRow.getCell(columns.get(name)!).value) : "";
      const raw = (name: string) => excelRow.getCell(columns.get(name) ?? 1).value;
      const row = occurrence(parsed, line, {}, sheet.name);
      parsed.totalRows++; parsed.occurrences.push(row);
      try {
        const externalId = read("ID");
        if (source.kind === "defense-person") {
          const id = normalizeIdentifier(externalId, "defense");
          // Numeric cells have already lost leading-zero evidence; never fabricate it.
          if (typeof raw("ID") === "number") row.issues.push({ code: "NUMERIC_ID_LEADING_ZERO_UNCERTAIN", severity: "warning", line });
          const name = read("NOME");
          if (!name) throw new ImportError("PERSON_NAME_MISSING");
          const groupPaths = [...new Set(read("GRUPO DE PESSOAS").split(",").map(normalizeLabel).filter(Boolean))].sort();
          const groups = [...new Set(groupPaths.map(path => path.split("/").map(part => part.trim()).filter(Boolean).at(-1)!).filter(Boolean))].sort();
          const photo = photoReference(raw("IMAGEM DE ROSTO 1"));
          row.original = { id: externalId, name, groups: read("GRUPO DE PESSOAS"), photoReference: photo ?? "", department: read("DEPARTAMENTO"), position: read("POSICAO"), identificationType: read("TIPO DE IDENTIFICACAO"), identificationNumber: read("NUMERO DE IDENTIFICACAO"), accessValidFrom: read("INICIO DE VERIFICACAO"), accessValidUntil: read("PERIODO DE VALIDADE") };
          row.person = { externalId: id, name, groups, groupPaths, photoReference: photo, original: row.original };
        } else {
          const identityValue = externalId && externalId !== "-" ? normalizeIdentifier(externalId, "defense") : null;
          const rawTimestamp = read("HORA"); const timestamp = parseLocalTimestamp(rawTimestamp, source.timeZone);
          const device = read("PONTO DE ACESSO"); if (!device) throw new ImportError("ACCESS_DEVICE_MISSING");
          const eventName = read("EVENTOS"); const eventType = read("TIPO DE EVENTO");
          const classification = classifyAccess(eventName, eventType, identityValue);
          const nativeId = read("ID DO EVENTO") || read("EVENT ID");
          const key = nativeId ? stableHash(["defense-native", source.id, nativeId]) : stableHash(["defense-fingerprint-v1", source.id, identityValue, normalizeLabel(device), timestamp, normalizeLabel(eventName), normalizeLabel(eventType), normalizeLabel(read("AMBIENTE")), normalizeLabel(read("TIPO DE PONTO DE ACESSO"))]);
          row.original = { externalId, name: read("PESSOA"), groups: read("GRUPO DE PESSOAS"), eventName, eventType, device, environment: read("AMBIENTE"), accessPointType: read("TIPO DE PONTO DE ACESSO"), entryExitStatus: read("STATUS DE ENTRADA/SAIDA"), rawTimestamp, nativeId };
          row.event = { key, type: "access", identity: identityValue ? { type: "defense", value: identityValue } : null, timestamp, device, classification, eligible: classification === "authorized" && identityValue !== null, rawTimestamp, rawIdentifier: externalId, precisionSeconds: 1, original: row.original, evidence: "access_authorization" };
          const ordinal = (frequencies.get(key) ?? 0) + 1; frequencies.set(key, ordinal); row.multiplicityOrdinal = ordinal;
          if (!nativeId) row.issues.push({ code: "EVENT_EQUIVALENCE_WITHOUT_NATIVE_ID", severity: "warning", line });
          updateRange(parsed, timestamp);
        }
        row.payloadHash = stableHash(row.original);
      } catch (error) { row.issues.push(recordIssue(errorCode(error), line)); }
    });
  }
  if (!found) throw new ImportError("XLSX_REQUIRED_HEADERS_MISSING");
  parsed.metadata = { worksheets: found, indistinguishableAdditionalOccurrences: [...frequencies.values()].reduce((sum, count) => sum + count - 1, 0), equivalencePolicy: "one_canonical_event_all_occurrences_preserved", groupHistory: "snapshot_not_retroactive", coverage: "observed_only" };
  return parsed;
}

export async function parseSnapshot(bytes: Buffer, source: IngestionSource): Promise<ParsedImport> {
  return source.kind === "afd" ? parseAfd(bytes, source) : parseWorkbook(bytes, source);
}

/** Used by persistence to detect AFD same-NSR conflicts while permitting mutable display fields. */
export function eventPayloadHash(event: CanonicalImportEvent): string {
  return stableHash({ key: event.key, identity: event.identity, timestamp: event.timestamp, device: normalizeLabel(event.device), type: event.type, classification: event.classification, eligible: event.eligible, nsr: event.nsr ?? null, ...(event.type === "punch" ? { record: event.original.record } : {}) });
}
