import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { ImportOccurrence } from "../ingestion/types.ts";

export const archiveVersion = 1;
export const archiveChunkRows = 5_000;
export const archiveObjectLimit = 20 * 1024 * 1024;
export const archiveExpandedLimit = 32 * 1024 * 1024;
// Organization Free quota is 1 GB; reserve headroom for originals and other features.
export const archiveStorageBudget = 800 * 1024 * 1024;
const monthFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" });

export type ArchiveObject = {
  path: string; sha256: string; bytes: number; expandedSha256: string; expandedBytes: number;
};
export type ArchivePart = ArchiveObject & {
  sourceId: string; fileSha256: string; month: string; rows: number; punches: number;
};
export type ArchiveSource = {
  sourceId: string; fileName: string; sha256: string; byteLength: number; parserVersion: string;
  encoding: "utf8" | "latin1"; profile: "legacy" | "iso"; identityType: "cpf" | "pis";
  allowAlternate: boolean; timeZone: "America/Sao_Paulo"; original: ArchiveObject;
  rows: number; punches: number; rejectedPunches: number; administrativeRows: number;
};
export type ArchiveManifest = {
  version: 1; projectRef: string; createdAt: string; asOf: string;
  retention: { payrollCycles: number; operationalFrom: string; eventFrom: string; boundaryBufferDays: 1 };
  coverage: "not_inferred";
  sources: ArchiveSource[]; parts: ArchivePart[];
  totals: { originalBytes: number; storedBytes: number; rows: number; punches: number; rejectedPunches: number; administrativeRows: number; hotPunches: number; coldPunches: number };
};
export type ArchivedRow = { sourceId: string; fileSha256: string; occurrence: ImportOccurrence };
export const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function archivePath(value: string): string {
  if (!value || value.length > 240 || !/^[a-zA-Z0-9/_.-]+$/.test(value)
    || value.split("/").some(part => !part || part === "." || part === "..")) throw new Error("ARCHIVE_PATH_INVALID");
  return value;
}

export function packObject(path: string, bytes: Buffer): { object: ArchiveObject; compressed: Buffer } {
  if (bytes.length > archiveExpandedLimit) throw new Error("ARCHIVE_EXPANDED_LIMIT");
  const compressed = gzipSync(bytes, { level: 9 });
  if (compressed.length > archiveObjectLimit) throw new Error("ARCHIVE_OBJECT_LIMIT");
  return { object: { path: archivePath(path), sha256: digest(compressed), bytes: compressed.length,
    expandedSha256: digest(bytes), expandedBytes: bytes.length }, compressed };
}

export function unpackObject(object: ArchiveObject, compressed: Buffer): Buffer {
  archivePath(object.path);
  if (!Number.isSafeInteger(object.bytes) || object.bytes < 1 || object.bytes > archiveObjectLimit
    || !Number.isSafeInteger(object.expandedBytes) || object.expandedBytes < 1 || object.expandedBytes > archiveExpandedLimit
    || compressed.length !== object.bytes || digest(compressed) !== object.sha256) throw new Error("ARCHIVE_HASH_MISMATCH");
  const bytes = gunzipSync(compressed, { maxOutputLength: archiveExpandedLimit });
  if (bytes.length !== object.expandedBytes || digest(bytes) !== object.expandedSha256) throw new Error("ARCHIVE_EXPANDED_HASH_MISMATCH");
  return bytes;
}

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
export function retentionWindow(asOf: string, payrollCycles = 3): ArchiveManifest["retention"] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf))
    || isoDate(new Date(`${asOf}T00:00:00Z`)) !== asOf
    || !Number.isInteger(payrollCycles) || payrollCycles < 1 || payrollCycles > 12) throw new Error("ARCHIVE_RETENTION_INVALID");
  const [year, month, day] = asOf.split("-").map(Number);
  const operational = new Date(Date.UTC(year, month - 1 - (day < 21 ? 1 : 0) - payrollCycles + 1, 21));
  if (operational.getUTCFullYear() < 2000) throw new Error("ARCHIVE_RETENTION_INVALID");
  const event = new Date(operational.getTime() - 86_400_000);
  return { payrollCycles, operationalFrom: isoDate(operational), eventFrom: `${isoDate(event)}T00:00:00-03:00`, boundaryBufferDays: 1 };
}

export function localMonth(timestamp: string): string {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) throw new Error("ARCHIVE_TIMESTAMP_INVALID");
  // Sao Paulo's historical offset must come from the timezone database, including DST.
  const parts = monthFormatter.formatToParts(time);
  return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}`;
}

export function punchKey(row: ArchivedRow): string | null {
  const event = row.occurrence.event;
  if (!event || event.type !== "punch") return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(row.sourceId) || !event.nsr || !/^\d{9}$/.test(event.nsr)) throw new Error("ARCHIVE_PUNCH_INVALID");
  return `${row.sourceId}:${event.nsr}`;
}

/** A changed raw payload is never silently treated as an already imported punch. */
export function indexPunch(index: Map<string, string>, row: ArchivedRow): "new" | "duplicate" | "conflict" | "not_punch" {
  const key = punchKey(row);
  if (key === null) return "not_punch";
  const hash = row.occurrence.payloadHash;
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("ARCHIVE_PUNCH_INVALID");
  const previous = index.get(key);
  if (previous === undefined) { index.set(key, hash); return "new"; }
  return previous === hash ? "duplicate" : "conflict";
}

export function partRows(bytes: Buffer): ArchivedRow[] {
  if (!bytes.length || bytes[bytes.length - 1] !== 10) throw new Error("ARCHIVE_PART_INCOMPLETE");
  const lines = bytes.toString("utf8").slice(0, -1).split("\n");
  if (lines.length > archiveChunkRows) throw new Error("ARCHIVE_CHUNK_ROWS_INVALID");
  return lines.map(line => {
    const row = JSON.parse(line) as ArchivedRow;
    if (!row || typeof row.sourceId !== "string" || !/^[a-f0-9]{64}$/.test(row.fileSha256)
      || !row.occurrence || !Number.isSafeInteger(row.occurrence.line) || row.occurrence.line < 1
      || !/^[a-f0-9]{64}$/.test(row.occurrence.payloadHash) || !Array.isArray(row.occurrence.issues)) throw new Error("ARCHIVE_ROW_INVALID");
    return row;
  });
}
