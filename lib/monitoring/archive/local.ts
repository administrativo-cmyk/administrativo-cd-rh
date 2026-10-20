import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseAfd } from "../ingestion/parsers.ts";
import { detectAfdEncoding } from "../cloud/detection.ts";
import { detectAfdProfile } from "../ingestion/parsers.ts";
import { normalizeIdentifier, parseOffsetTimestamp } from "../ingestion/validation.ts";
import { archiveChunkRows, archivePath, archiveStorageBudget, digest, indexPunch, localMonth, packObject, partRows, retentionWindow, unpackObject,
  type ArchivedRow, type ArchiveManifest, type ArchivePart, type ArchiveSource } from "./format.ts";

export type ArchiveInput = { sourceId: string; path: string; sha256: string; profile: "legacy" | "iso"; identityType: "cpf" | "pis"; allowAlternate?: boolean };
export type ArchiveConfiguration = { projectRef: string; asOf: string; payrollCycles?: number; files: ArchiveInput[] };

function assertConfiguration(config: ArchiveConfiguration) {
  if (!config || !/^[a-z]{20}$/.test(config.projectRef) || !Array.isArray(config.files) || !config.files.length || config.files.length > 20) throw new Error("ARCHIVE_CONFIG_INVALID");
  const sourceFiles = new Set<string>();
  for (const file of config.files) {
    if (!file || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(file.sourceId) || typeof file.path !== "string" || !path.isAbsolute(file.path)
      || !/^[a-f0-9]{64}$/.test(file.sha256) || !["legacy", "iso"].includes(file.profile) || !["cpf", "pis"].includes(file.identityType)
      || (file.allowAlternate !== undefined && typeof file.allowAlternate !== "boolean")) throw new Error("ARCHIVE_CONFIG_INVALID");
    const key = `${file.sourceId}:${file.sha256}`;
    if (sourceFiles.has(key)) throw new Error("ARCHIVE_INPUT_REPEATED");
    sourceFiles.add(key);
  }
  retentionWindow(config.asOf, config.payrollCycles);
}

async function readOriginal(file: ArchiveInput) {
  const info = await stat(file.path);
  if (!info.isFile() || info.size < 1 || info.size > 20 * 1024 * 1024) throw new Error("ARCHIVE_INPUT_SIZE_INVALID");
  const bytes = await readFile(file.path);
  if (digest(bytes) !== file.sha256) throw new Error("ARCHIVE_INPUT_HASH_MISMATCH");
  const encoding = detectAfdEncoding(bytes);
  const profile = detectAfdProfile(encoding === "latin1" ? bytes.toString("latin1") : bytes.toString("utf8"));
  if (profile !== file.profile) throw new Error("ARCHIVE_INPUT_PROFILE_MISMATCH");
  const parsed = parseAfd(bytes, { id: file.sourceId, kind: "afd", root: "", timeZone: "America/Sao_Paulo", encoding,
    afdProfile: profile, afdIdentityType: file.identityType, afdAllowAlternate: file.allowAlternate ?? true, sourceIdentityConfirmed: true });
  return { bytes, encoding, profile, parsed };
}

async function put(root: string, relative: string, bytes: Buffer) {
  archivePath(relative);
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
}

/** Read only from original inputs. A completed manifest is written last; no database or network mutation exists here. */
export async function prepareArchive(config: ArchiveConfiguration, output: string, progress: (message: string) => void = () => undefined) {
  assertConfiguration(config);
  const root = path.resolve(output);
  // Never reuse an existing directory. Failed runs remain available for inspection.
  await mkdir(root, { recursive: false, mode: 0o700 });
  const manifest: ArchiveManifest = { version: 1, projectRef: config.projectRef, createdAt: new Date().toISOString(), asOf: config.asOf,
    retention: retentionWindow(config.asOf, config.payrollCycles), coverage: "not_inferred", sources: [], parts: [],
    totals: { originalBytes: 0, storedBytes: 0, rows: 0, punches: 0, rejectedPunches: 0, administrativeRows: 0, hotPunches: 0, coldPunches: 0 } };
  for (const file of config.files) {
    progress(`Lendo ${file.sourceId}`);
    const { bytes, parsed, encoding, profile } = await readOriginal(file);
    const original = packObject(`originals/${file.sourceId}/${file.sha256}.txt.gz`, bytes);
    await put(root, original.object.path, original.compressed);
    const groups = new Map<string, ArchivedRow[]>();
    let rejectedPunches = 0; let punches = 0; let hot = 0; let administrativeRows = 0;
    for (const occurrence of parsed.occurrences) {
      const event = occurrence.event;
      const month = event ? localMonth(event.timestamp) : "unclassified";
      const row: ArchivedRow = { sourceId: file.sourceId, fileSha256: file.sha256, occurrence };
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month)!.push(row);
      if (event) {
        punches++;
        if (Date.parse(event.timestamp) >= Date.parse(manifest.retention.eventFrom)) hot++;
      } else if (occurrence.original.record?.[9] === "3") rejectedPunches++;
      else administrativeRows++;
    }
    for (const [month, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      for (let offset = 0; offset < rows.length; offset += archiveChunkRows) {
        const chunk = rows.slice(offset, offset + archiveChunkRows);
        const raw = Buffer.from(chunk.map(row => JSON.stringify(row)).join("\n") + "\n");
        const packed = packObject(`rows/${file.sourceId}/${file.sha256}/${month}/${String(offset / archiveChunkRows).padStart(5, "0")}.ndjson.gz`, raw);
        await put(root, packed.object.path, packed.compressed);
        const part: ArchivePart = { ...packed.object, sourceId: file.sourceId, fileSha256: file.sha256, month,
          rows: chunk.length, punches: chunk.filter(row => row.occurrence.event?.type === "punch").length };
        manifest.parts.push(part); manifest.totals.storedBytes += part.bytes;
      }
    }
    const source: ArchiveSource = { sourceId: file.sourceId, fileName: path.basename(file.path), sha256: file.sha256,
      byteLength: bytes.length, parserVersion: parsed.parserVersion, encoding, profile, identityType: file.identityType,
      allowAlternate: file.allowAlternate ?? true, timeZone: "America/Sao_Paulo", original: original.object,
      rows: parsed.occurrences.length, punches, rejectedPunches, administrativeRows };
    manifest.sources.push(source);
    manifest.totals.originalBytes += bytes.length;
    manifest.totals.storedBytes += original.object.bytes;
    manifest.totals.rows += source.rows;
    manifest.totals.punches += punches;
    manifest.totals.rejectedPunches += rejectedPunches;
    manifest.totals.administrativeRows += administrativeRows;
    manifest.totals.hotPunches += hot; manifest.totals.coldPunches += punches - hot;
    // Re-read after the full parse/write, so an input modified during preparation cannot be sealed.
    if (digest(await readFile(file.path)) !== file.sha256) throw new Error("ARCHIVE_INPUT_CHANGED");
    progress(`${file.sourceId}: ${punches} batidas; ${parsed.occurrences.length} registros preservados`);
  }
  if (manifest.totals.storedBytes > archiveStorageBudget) throw new Error("ARCHIVE_STORAGE_BUDGET_EXCEEDED");
  const serialized = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  await put(root, "manifest.prepared.json", serialized);
  const receipt = await verifyArchive(root, "manifest.prepared.json", progress);
  if (receipt.conflicts > 0) throw new Error("ARCHIVE_CONFLICT_REQUIRES_REVIEW");
  await put(root, "manifest.json", serialized);
  await put(root, "verification.json", Buffer.from(JSON.stringify({ ...receipt, manifestSha256: digest(serialized), verifiedAt: new Date().toISOString(),
    databaseChanged: false, storageUploaded: false, cleanupAllowed: false }, null, 2) + "\n"));
  return { manifest, receipt };
}

export async function archiveFile(root: string, relative: string): Promise<Buffer> {
  archivePath(relative);
  const absoluteRoot = await realpath(root);
  const target = await realpath(path.join(absoluteRoot, relative));
  const resolved = path.relative(absoluteRoot, target);
  if (!resolved || resolved === ".." || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved)) throw new Error("ARCHIVE_PATH_ESCAPE");
  const info = await stat(target);
  if (!info.isFile() || info.size > archiveObjectLimitFor(relative)) throw new Error("ARCHIVE_FILE_SIZE_INVALID");
  return readFile(target);
}
function archiveObjectLimitFor(relative: string) { return /\.(gz|txt)$/.test(relative) ? 20 * 1024 * 1024 : 2 * 1024 * 1024; }

function checkManifest(manifest: ArchiveManifest) {
  if (!manifest || manifest.version !== 1 || !/^[a-z]{20}$/.test(manifest.projectRef) || manifest.coverage !== "not_inferred"
    || !Array.isArray(manifest.sources) || !manifest.sources.length || manifest.sources.length > 20 || !Array.isArray(manifest.parts) || manifest.parts.length > 10_000
    || !manifest.retention || JSON.stringify(manifest.retention) !== JSON.stringify(retentionWindow(manifest.asOf, manifest.retention.payrollCycles))) throw new Error("ARCHIVE_MANIFEST_INVALID");
  const paths = new Set<string>();
  const sources = new Set<string>();
  for (const source of manifest.sources) {
    const key = `${source.sourceId}:${source.sha256}`;
    if (sources.has(key) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(source.sourceId)
      || !/^[a-f0-9]{64}$/.test(source.sha256) || !source.original || source.original.expandedSha256 !== source.sha256
      || source.byteLength !== source.original.expandedBytes || !["utf8", "latin1"].includes(source.encoding)
      || !["legacy", "iso"].includes(source.profile) || !["cpf", "pis"].includes(source.identityType)
      || typeof source.allowAlternate !== "boolean" || source.timeZone !== "America/Sao_Paulo") throw new Error("ARCHIVE_MANIFEST_INVALID");
    sources.add(key);
  }
  for (const object of [...manifest.sources.map(source => source.original), ...manifest.parts]) {
    archivePath(object.path);
    if (paths.has(object.path)) throw new Error("ARCHIVE_MANIFEST_INVALID");
    paths.add(object.path);
  }
  for (const part of manifest.parts) {
    if (!sources.has(`${part.sourceId}:${part.fileSha256}`) || !/^(\d{4}-\d{2}|unclassified)$/.test(part.month)
      || !Number.isSafeInteger(part.rows) || part.rows < 1 || part.rows > archiveChunkRows) throw new Error("ARCHIVE_MANIFEST_INVALID");
  }
}

/** Verification needs only the archive. The original source folder is not required for restoration. */
export async function verifyArchive(root: string, name = "manifest.json", progress: (message: string) => void = () => undefined) {
  const manifest = JSON.parse((await archiveFile(root, name)).toString("utf8")) as ArchiveManifest;
  checkManifest(manifest);
  const index = new Map<string, string>();
  const totals = { originalBytes: 0, storedBytes: 0, rows: 0, punches: 0, rejectedPunches: 0, administrativeRows: 0, hotPunches: 0, coldPunches: 0 };
  let duplicates = 0; let conflicts = 0;
  for (const source of manifest.sources) {
    const bytes = unpackObject(source.original, await archiveFile(root, source.original.path));
    if (digest(bytes) !== source.sha256) throw new Error("ARCHIVE_ORIGINAL_MISMATCH");
    totals.originalBytes += bytes.length; totals.storedBytes += source.original.bytes;
    const parsed = parseAfd(bytes, { id: source.sourceId, kind: "afd", root: "", timeZone: source.timeZone, encoding: source.encoding,
      afdProfile: source.profile, afdIdentityType: source.identityType, afdAllowAlternate: source.allowAlternate, sourceIdentityConfirmed: true });
    if (parsed.parserVersion !== source.parserVersion || parsed.skipped || parsed.occurrences.length !== source.rows) throw new Error("ARCHIVE_PARSER_MISMATCH");
    const expected = new Map(parsed.occurrences.map(row => [row.line, row]));
    const lines = new Set<number>();
    const count = { rows: 0, punches: 0, rejectedPunches: 0, administrativeRows: 0 };
    progress(`Original conferido: ${source.sourceId}`);
    for (const part of manifest.parts.filter(part => part.sourceId === source.sourceId && part.fileSha256 === source.sha256)) {
      const rows = partRows(unpackObject(part, await archiveFile(root, part.path)));
      if (rows.length !== part.rows) throw new Error("ARCHIVE_PART_COUNT_MISMATCH");
      let partPunches = 0;
      for (const row of rows) {
        if (row.sourceId !== part.sourceId || row.fileSha256 !== part.fileSha256) throw new Error("ARCHIVE_PART_SOURCE_MISMATCH");
        if (JSON.stringify(row.occurrence) !== JSON.stringify(expected.get(row.occurrence.line))) throw new Error("ARCHIVE_ROW_ORIGINAL_MISMATCH");
        if (lines.has(row.occurrence.line)) throw new Error("ARCHIVE_LINE_REPEATED");
        lines.add(row.occurrence.line); count.rows++; totals.rows++;
        const event = row.occurrence.event;
        if ((event ? localMonth(event.timestamp) : "unclassified") !== part.month) throw new Error("ARCHIVE_PART_MONTH_MISMATCH");
        if (event) {
          if (event.type !== "punch") throw new Error("ARCHIVE_EVENT_INVALID");
          count.punches++; totals.punches++; partPunches++;
          if (Date.parse(event.timestamp) >= Date.parse(manifest.retention.eventFrom)) totals.hotPunches++;
          else totals.coldPunches++;
        } else if (row.occurrence.original.record?.[9] === "3") { count.rejectedPunches++; totals.rejectedPunches++; }
        else { count.administrativeRows++; totals.administrativeRows++; }
        const verdict = indexPunch(index, row);
        if (verdict === "duplicate") duplicates++;
        if (verdict === "conflict") conflicts++;
      }
      if (partPunches !== part.punches) throw new Error("ARCHIVE_PART_COUNT_MISMATCH");
      totals.storedBytes += part.bytes;
    }
    for (const key of ["rows", "punches", "rejectedPunches", "administrativeRows"] as const) if (count[key] !== source[key]) throw new Error("ARCHIVE_SOURCE_COUNT_MISMATCH");
  }
  for (const key of Object.keys(totals) as (keyof typeof totals)[]) if (totals[key] !== manifest.totals[key]) throw new Error("ARCHIVE_TOTAL_MISMATCH");
  if (totals.storedBytes > archiveStorageBudget) throw new Error("ARCHIVE_STORAGE_BUDGET_EXCEEDED");
  return { ...totals, objects: manifest.sources.length + manifest.parts.length, uniquePunches: index.size, duplicates, conflicts };
}

/** Compare a re-export against the archive without inserting anything in Postgres. */
export async function reconcileArchive(root: string, config: ArchiveConfiguration) {
  assertConfiguration(config);
  await verifyArchive(root);
  const manifest = JSON.parse((await archiveFile(root, "manifest.json")).toString("utf8")) as ArchiveManifest;
  if (manifest.projectRef !== config.projectRef) throw new Error("ARCHIVE_PROJECT_MISMATCH");
  const index = new Map<string, string>();
  for (const part of manifest.parts) for (const row of partRows(unpackObject(part, await archiveFile(root, part.path)))) indexPunch(index, row);
  const result = { newPunches: 0, repeatedPunches: 0, conflicts: 0, files: config.files.length, databaseChanged: false };
  for (const file of config.files) {
    const { parsed } = await readOriginal(file);
    for (const occurrence of parsed.occurrences) {
      const verdict = indexPunch(index, { sourceId: file.sourceId, fileSha256: file.sha256, occurrence });
      if (verdict === "new") result.newPunches++;
      if (verdict === "duplicate") result.repeatedPunches++;
      if (verdict === "conflict") result.conflicts++;
    }
  }
  return result;
}

export async function restoreArchiveOriginals(root: string, output: string) {
  await verifyArchive(root);
  const manifest = JSON.parse((await archiveFile(root, "manifest.json")).toString("utf8")) as ArchiveManifest;
  const target = path.resolve(output);
  await mkdir(target, { recursive: false, mode: 0o700 });
  const restored: Array<{ path: string; sha256: string; bytes: number }> = [];
  for (const source of manifest.sources) {
    const bytes = unpackObject(source.original, await archiveFile(root, source.original.path));
    const relative = `${source.sourceId}-${source.sha256}.txt`;
    await put(target, relative, bytes);
    if (digest(await archiveFile(target, relative)) !== source.sha256) throw new Error("ARCHIVE_RESTORE_MISMATCH");
    restored.push({ path: relative, sha256: source.sha256, bytes: bytes.length });
  }
  return { files: restored, databaseChanged: false };
}

export type ArchiveHistoryFilter = { sourceId: string; identityType: "cpf" | "pis"; identity: string; from: string; to: string };
/** Offline history inspection. Application access still requires the employee/role checks in the future server adapter. */
export async function readArchiveHistory(root: string, filter: ArchiveHistoryFilter) {
  if (!filter || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(filter.sourceId) || !["cpf", "pis"].includes(filter.identityType)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(filter.from)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(filter.to)) throw new Error("ARCHIVE_HISTORY_FILTER_INVALID");
  normalizeIdentifier(filter.identity, filter.identityType);
  const epoch = (value: string) => Date.parse(parseOffsetTimestamp(value.endsWith("Z") ? value.slice(0, -1) + "+0000" : value.replace(/([+-]\d{2}):(\d{2})$/, "$1$2")));
  const start = epoch(filter.from); const end = epoch(filter.to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 367 * 86_400_000) throw new Error("ARCHIVE_HISTORY_FILTER_INVALID");
  const manifest = JSON.parse((await archiveFile(root, "manifest.json")).toString("utf8")) as ArchiveManifest;
  checkManifest(manifest);
  if (!manifest.sources.some(source => source.sourceId === filter.sourceId)) throw new Error("ARCHIVE_HISTORY_SOURCE_NOT_FOUND");
  const minMonth = localMonth(filter.from); const maxMonth = localMonth(new Date(end - 1).toISOString());
  const rows: ArchivedRow[] = [];
  for (const part of manifest.parts.filter(part => part.sourceId === filter.sourceId && part.month >= minMonth && part.month <= maxMonth)) {
    for (const row of partRows(unpackObject(part, await archiveFile(root, part.path)))) {
      const event = row.occurrence.event;
      if (row.sourceId !== part.sourceId || row.fileSha256 !== part.fileSha256) throw new Error("ARCHIVE_PART_SOURCE_MISMATCH");
      if (event && event.identity?.type === filter.identityType && event.identity.value === filter.identity
        && Date.parse(event.timestamp) >= start && Date.parse(event.timestamp) < end) rows.push(row);
    }
  }
  const unique = new Map<string, ArchivedRow>(); const conflict = new Set<string>();
  const references = new Map<string, Array<{fileSha256: string; line: number}>>();
  for (const row of rows) {
    const key = `${row.sourceId}:${row.occurrence.event!.nsr}`;
    const previous = unique.get(key);
    if (previous && previous.occurrence.payloadHash !== row.occurrence.payloadHash) conflict.add(key);
    if (!previous) unique.set(key, row);
    if (!references.has(key)) references.set(key, []);
    references.get(key)!.push({ fileSha256: row.fileSha256, line: row.occurrence.line });
  }
  return [...unique.entries()].map(([key, row]) => ({ sourceId: row.sourceId, nsr: row.occurrence.event!.nsr!,
    timestamp: row.occurrence.event!.timestamp, precisionSeconds: row.occurrence.event!.precisionSeconds,
    conflicted: conflict.has(key), originalReferences: references.get(key)! }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.sourceId.localeCompare(b.sourceId) || a.nsr.localeCompare(b.nsr));
}
