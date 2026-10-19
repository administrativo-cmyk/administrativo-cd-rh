import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { mkdir, readFile, realpath, rename, writeFile, unlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { buildPhotoIndex, listSourceFiles, loadPhoto, readStableSnapshot } from "./files.ts";
import { eventPayloadHash, parseSnapshot } from "./parsers.ts";
import { ImportError, errorCode, stableHash } from "./validation.ts";
import type { IngestionSource, IngestionTransport, ParsedImport, WorkerConfig } from "./types.ts";
import { batchesFor } from "./batches.ts";
export { batchesFor } from "./batches.ts";

interface WorkerState { version: 1; completed: Record<string, { completedAt: string; parserVersion: string }>; photos: Record<string, string>; }
export interface SourceSummary {
  sourceId: string;
  files: number;
  repeatedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  rows: number;
  acceptedRows: number;
  uniqueEvents: number;
  repeatedEvents: number;
  conflictingEvents: number;
  rejectedRows: number;
  persons: number;
  uniqueIdentities: number;
  leadingZeroIds: number;
  photoReferences: number;
  photosValidated: number;
  photosPending: number;
  classifications: Record<string, number>;
  issueCounts: Record<string, number>;
  observedRange: ParsedImport["observedRange"];
  dryRun: boolean;
  reprocessedJobs?: number;
  pendingReprocessJobs?: number;
  apiErrors?: Array<{ code: string; httpStatus: number; apiCode?: string; correlationId?: string }>;
}
export interface ScanOptions { apply?: boolean; reprocess?: boolean; sourceId?: string; from?: string; to?: string; signal?: AbortSignal; onProgress?: (summary: SourceSummary) => void; }
const emptySummary = (sourceId: string, dryRun: boolean): SourceSummary => ({ sourceId, dryRun, files: 0, repeatedFiles: 0, skippedFiles: 0, failedFiles: 0, rows: 0, acceptedRows: 0, uniqueEvents: 0, repeatedEvents: 0, conflictingEvents: 0, rejectedRows: 0, persons: 0, uniqueIdentities: 0, leadingZeroIds: 0, photoReferences: 0, photosValidated: 0, photosPending: 0, classifications: {}, issueCounts: {}, observedRange: null });
const addIssue = (summary: SourceSummary, code: string): void => { summary.issueCounts[code] = (summary.issueCounts[code] ?? 0) + 1; };
const addFailure = (summary: SourceSummary, error: unknown): void => {
  addIssue(summary, errorCode(error));
  if (error instanceof ImportError && error.httpStatus && (summary.apiErrors?.length ?? 0) < 20) {
    summary.apiErrors ??= [];
    summary.apiErrors.push({ code: error.code, httpStatus: error.httpStatus, ...(error.apiCode ? { apiCode: error.apiCode } : {}), ...(error.correlationId ? { correlationId: error.correlationId } : {}) });
  }
};

export function validateConfig(input: unknown, baseDirectory: string): WorkerConfig {
  if (!input || typeof input !== "object") throw new ImportError("INVALID_WORKER_CONFIG");
  const config = input as WorkerConfig;
  if (config.version !== 1 || !Array.isArray(config.sources) || !config.sources.length || config.sources.length > 100 || typeof config.stateDirectory !== "string") throw new ImportError("INVALID_WORKER_CONFIG");
  const ids = new Set<string>();
  for (const source of config.sources) {
    if (!source || typeof source.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(source.id) || ids.has(source.id) || !["afd", "defense-access", "defense-person"].includes(source.kind) || typeof source.root !== "string" || typeof source.timeZone !== "string") throw new ImportError("INVALID_SOURCE_CONFIG");
    if (source.identityNamespace && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(source.identityNamespace)) throw new ImportError("INVALID_IDENTITY_NAMESPACE");
    if (source.enabled !== undefined && typeof source.enabled !== "boolean") throw new ImportError("INVALID_SOURCE_CONFIG");
    if (source.afdProfile && !["legacy", "iso"].includes(source.afdProfile)) throw new ImportError("INVALID_AFD_PROFILE");
    if (source.afdAllowAlternate !== undefined && typeof source.afdAllowAlternate !== "boolean") throw new ImportError("INVALID_SOURCE_CONFIG");
    if (source.afdIdentityType && !["cpf", "pis"].includes(source.afdIdentityType)) throw new ImportError("INVALID_AFD_IDENTITY_TYPE");
    if (source.encoding && !["utf8", "latin1"].includes(source.encoding)) throw new ImportError("INVALID_SOURCE_ENCODING");
    if ((source.recursive !== undefined && typeof source.recursive !== "boolean") || (source.sourceIdentityConfirmed !== undefined && typeof source.sourceIdentityConfirmed !== "boolean") || (source.photoRoot !== undefined && typeof source.photoRoot !== "string")) throw new ImportError("INVALID_SOURCE_CONFIG");
    try { new Intl.DateTimeFormat("pt-BR", { timeZone: source.timeZone }).format(); } catch { throw new ImportError("INVALID_SOURCE_TIME_ZONE"); }
    if (source.declaredCoverage && (!Number.isFinite(Date.parse(source.declaredCoverage.from)) || !Number.isFinite(Date.parse(source.declaredCoverage.to)) || source.declaredCoverage.from >= source.declaredCoverage.to || typeof source.declaredCoverage.continuous !== "boolean")) throw new ImportError("INVALID_DECLARED_COVERAGE");
    source.root = resolve(baseDirectory, source.root);
    if (source.photoRoot) source.photoRoot = resolve(baseDirectory, source.photoRoot);
    ids.add(source.id);
  }
  const limits: Array<[keyof WorkerConfig, number, number]> = [["scanIntervalMs", 1000, 3_600_000], ["stabilityMs", 100, 60_000], ["batchSize", 1, 500], ["maxFileBytes", 1024, 80 * 1024 * 1024]];
  for (const [key, minimum, maximum] of limits) if (config[key] !== undefined && (!Number.isInteger(config[key]) || Number(config[key]) < minimum || Number(config[key]) > maximum)) throw new ImportError("INVALID_WORKER_LIMIT");
  if (config.endpoint !== undefined && typeof config.endpoint !== "string") throw new ImportError("INVALID_INGEST_ENDPOINT");
  if (config.tokenEnvironmentVariable !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(config.tokenEnvironmentVariable)) throw new ImportError("INVALID_TOKEN_ENVIRONMENT_VARIABLE");
  config.stateDirectory = resolve(baseDirectory, config.stateDirectory);
  return config;
}

async function readState(directory: string): Promise<WorkerState> {
  try {
    const state = JSON.parse(await readFile(resolve(directory, "state.json"), "utf8")) as WorkerState;
    if (state.version !== 1 || !state.completed || typeof state.completed !== "object" || Array.isArray(state.completed)) throw new ImportError("WORKER_STATE_INVALID");
    state.photos ??= {};
    if (typeof state.photos !== "object" || Array.isArray(state.photos)) throw new ImportError("WORKER_STATE_INVALID");
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, completed: {}, photos: {} };
    if (error instanceof ImportError) throw error;
    throw new ImportError("WORKER_STATE_INVALID");
  }
}
async function saveState(directory: string, state: WorkerState): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = resolve(directory, `state-${randomUUID()}.tmp`);
  try { await writeFile(temporary, JSON.stringify(state), { flag: "wx", mode: 0o600 }); await rename(temporary, resolve(directory, "state.json")); }
  finally { await unlink(temporary).catch(() => undefined); }
}

function includeFile(parsed: ParsedImport, options: ScanOptions): boolean {
  if (!parsed.observedRange) return true;
  // Keep whole immutable file, including surrounding records; never change file identity for a filter.
  const from = options.from ? Date.parse(`${options.from}T00:00:00Z`) - 36 * 3_600_000 : -Infinity;
  const to = options.to ? Date.parse(`${options.to}T23:59:59Z`) + 36 * 3_600_000 : Infinity;
  return Date.parse(parsed.observedRange.to) >= from && Date.parse(parsed.observedRange.from) <= to;
}

export async function scanSources(config: WorkerConfig, options: ScanOptions = {}, transport?: IngestionTransport): Promise<SourceSummary[]> {
  if (options.apply && !transport) throw new ImportError("PERSISTENCE_TRANSPORT_REQUIRED");
  if (options.sourceId && !config.sources.some(source => source.id === options.sourceId)) throw new ImportError("SOURCE_NOT_CONFIGURED");
  const state: WorkerState = options.apply ? await readState(config.stateDirectory) : { version: 1, completed: {}, photos: {} };
  const summaries: SourceSummary[] = [];
  const selectedSources = config.sources.filter(source => !options.sourceId || source.id === options.sourceId);
  const remote = options.apply && transport?.sources ? await transport.sources({ sourceIds: selectedSources.filter(source => source.enabled !== false).map(source => source.id) }) : null;
  const activeIds: string[] = [];
  for (const localSource of selectedSources) {
    let source = localSource;
    options.signal?.throwIfAborted();
    const summary = emptySummary(source.id, !options.apply); summaries.push(summary);
    if (source.enabled === false) { addIssue(summary, "SOURCE_DISABLED_LOCALLY"); continue; }
    if (remote) {
      const metadata = remote.sources.find(value => value.id === source.id);
      if (!metadata) { addIssue(summary, "SOURCE_NOT_REGISTERED"); summary.failedFiles++; continue; }
      if (!metadata.active) { addIssue(summary, "SOURCE_DISABLED"); continue; }
      if (metadata.kind !== source.kind || metadata.identityNamespace !== (source.identityNamespace ?? source.id) || metadata.timeZone !== source.timeZone) { addIssue(summary, "SOURCE_LOCAL_CONTRACT_MISMATCH"); summary.failedFiles++; continue; }
      source = { ...source, sourceIdentityConfirmed: metadata.sourceIdentityConfirmed, declaredCoverage: metadata.declaredCoverage ?? undefined };
    }
    activeIds.push(source.id);
    const keys = new Map<string, string>(); const identities = new Set<string>(); const seenFiles = new Set<string>();
    let photoIndex: Map<string, string[]> | undefined;
    try {
      if (options.apply) {
        const { id, kind, timeZone, identityNamespace, sourceIdentityConfirmed, declaredCoverage } = source;
        await transport!.heartbeat(source.id, "scanning", undefined, { id, kind, timeZone, identityNamespace, sourceIdentityConfirmed, declaredCoverage });
      }
      const paths = await listSourceFiles(source);
      const actualRoot = await realpath(source.root);
      if (source.kind === "defense-person" && source.photoRoot) photoIndex = await buildPhotoIndex(source.photoRoot);
      for (const path of paths) {
        options.signal?.throwIfAborted(); summary.files++;
        try {
          const bytes = await readStableSnapshot(source.root, path, { stabilityMs: config.stabilityMs, maxBytes: config.maxFileBytes, signal: options.signal });
          const parsed = await parseSnapshot(bytes, source);
          if (parsed.skipped || !includeFile(parsed, options)) { summary.skippedFiles++; continue; }
          const stateKey = `${source.id}:${parsed.sha256}:${parsed.parserVersion}`;
          const alreadyCompleted = Boolean(state.completed[stateKey] && !options.reprocess);
          if (seenFiles.has(stateKey)) { summary.repeatedFiles++; continue; }
          seenFiles.add(stateKey);
          if (alreadyCompleted) {
            summary.repeatedFiles++;
            // Photos may arrive or change days after the workbook. They have an independent checkpoint.
            if (source.kind === "defense-person") await processPhotos(parsed, source, summary, state, photoIndex, options.apply ? transport : undefined, config.stateDirectory, options.reprocess);
            continue;
          }
          summary.rows += parsed.totalRows;
          for (const issue of parsed.issues) addIssue(summary, issue.code);
          if (parsed.observedRange) summary.observedRange = summary.observedRange ? { from: summary.observedRange.from < parsed.observedRange.from ? summary.observedRange.from : parsed.observedRange.from, to: summary.observedRange.to > parsed.observedRange.to ? summary.observedRange.to : parsed.observedRange.to } : parsed.observedRange;
          for (const row of parsed.occurrences) {
            for (const issue of row.issues) addIssue(summary, issue.code);
            if (row.issues.some(issue => issue.severity === "error")) summary.rejectedRows++;
            else if (row.event || row.person) summary.acceptedRows++;
            if (row.event) {
              const payload = eventPayloadHash(row.event); const previous = keys.get(row.event.key);
              if (!previous) { keys.set(row.event.key, payload); summary.uniqueEvents++; }
              else if (previous !== payload) summary.conflictingEvents++;
              else summary.repeatedEvents++;
              if (row.event.identity) identities.add(`${row.event.identity.type}:${row.event.identity.value}`);
              summary.classifications[row.event.classification] = (summary.classifications[row.event.classification] ?? 0) + 1;
            }
            if (row.person) {
              summary.persons++; identities.add(`defense:${row.person.externalId}`);
              if (row.person.externalId.startsWith("0")) summary.leadingZeroIds++;
            }
          }
          summary.uniqueIdentities = identities.size;
          if (options.apply) {
            for (const batch of batchesFor(parsed, source, relative(actualRoot, path).replace(/\\/g, "/"), config.batchSize)) {
              options.signal?.throwIfAborted();
              const response = await transport!.persist(batch);
              if (!response.accepted) throw new ImportError("INGEST_BATCH_NOT_ACKNOWLEDGED");
              if (batch.batch.final && !["complete", "conflict"].includes(response.fileStatus ?? "")) throw new ImportError("INGEST_FILE_NOT_CONFIRMED_COMPLETE");
            }
            // Register the completed workbook first; independent photo failures remain retryable.
            state.completed[stateKey] = { completedAt: new Date().toISOString(), parserVersion: parsed.parserVersion };
            await saveState(config.stateDirectory, state);
          }
          if (source.kind === "defense-person") await processPhotos(parsed, source, summary, state, photoIndex, options.apply ? transport : undefined, config.stateDirectory, options.reprocess);
        } catch (error) {
          if (options.signal?.aborted) throw error;
          summary.failedFiles++; addFailure(summary, error);
          if (options.apply && transport?.failure) await transport.failure({ sourceId: source.id, relativePath: relative(actualRoot, path).replace(/\\/g, "/"), code: errorCode(error) }).catch((cause) => { addIssue(summary, "FAILURE_REPORT_NOT_DELIVERED"); addFailure(summary, cause); });
        }
        options.onProgress?.({ ...summary });
      }
      if (options.apply) await transport!.heartbeat(source.id, summary.failedFiles ? "error" : "idle", summary.failedFiles ? "FILES_PENDING_RETRY" : undefined);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      summary.failedFiles++; addFailure(summary, error);
      if (options.apply) await transport!.heartbeat(source.id, "error", errorCode(error)).catch((cause) => addFailure(summary, cause));
    }
  }
  if (options.apply && transport?.reprocess && summaries.length && activeIds.length) {
    const sourceIds = activeIds;
    let processed = 0;
    try {
      // A finite drain keeps the periodic worker responsive. Remaining jobs survive on the server.
      for (let attempt = 0; attempt < 100 && processed < 1000; attempt++) {
        options.signal?.throwIfAborted();
        const result = await transport.reprocess({ sourceIds, limit: Math.min(10, 1000 - processed) });
        processed += result.processed;
        summaries[0].reprocessedJobs = processed; summaries[0].pendingReprocessJobs = result.pending;
        if (result.failed) { addIssue(summaries[0], "REPROCESS_JOBS_FAILED"); break; }
        if (!result.pending || !result.processed) break;
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      addFailure(summaries[0], error);
    }
  }
  return summaries;
}

async function processPhotos(parsed: ParsedImport, source: IngestionSource, summary: SourceSummary, state: WorkerState, photoIndex: Map<string, string[]> | undefined, transport: IngestionTransport | undefined, stateDirectory: string, reprocess?: boolean): Promise<void> {
  let checkpointChanged = false;
  for (const row of parsed.occurrences) {
    if (!row.person) continue;
    if (!row.person.photoReference) { summary.photosPending++; addIssue(summary, "PHOTO_REFERENCE_MISSING"); continue; }
    summary.photoReferences++;
    if (!source.photoRoot) { summary.photosPending++; addIssue(summary, "PHOTO_ROOT_NOT_CONFIGURED"); continue; }
    try {
      const photo = await loadPhoto(source.photoRoot, row.person.photoReference, photoIndex);
      summary.photosValidated++;
      // Do not put external identities or photo filenames in the local checkpoint.
      const key = stableHash(["photo", source.identityNamespace ?? source.id, row.person.externalId]);
      if (transport?.photo && (state.photos[key] !== photo.sha256 || reprocess)) {
        await transport.photo({ sourceId: source.id, identityValue: row.person.externalId, sha256: photo.sha256, mimeType: photo.mimeType, base64: photo.bytes.toString("base64") });
        state.photos[key] = photo.sha256; checkpointChanged = true;
      }
    } catch (error) {
      summary.photosPending++; addFailure(summary, error);
      if (transport?.failure) await transport.failure({ sourceId: source.id, relativePath: `photo-reference-line-${row.line}`, code: errorCode(error) }).catch((cause) => { addIssue(summary, "FAILURE_REPORT_NOT_DELIVERED"); addFailure(summary, cause); });
    }
  }
  if (checkpointChanged) await saveState(stateDirectory, state);
}

/** Filesystem notifications improve latency; periodic scans recover lost notifications/restarts. */
export async function watchSources(config: WorkerConfig, options: ScanOptions, transport?: IngestionTransport): Promise<void> {
  let changed = true;
  const watchers: ReturnType<typeof watch>[] = [];
  for (const source of config.sources.filter(source => !options.sourceId || source.id === options.sourceId)) {
    try { const watcher = watch(source.root, { recursive: source.recursive ?? false }, () => { changed = true; }); watcher.on("error", () => { changed = true; }); watchers.push(watcher); } catch { /* The periodic scan reports inaccessible sources and retries them. */ }
  }
  let lastScan = 0;
  try {
    while (!options.signal?.aborted) {
      if (changed || Date.now() - lastScan >= (config.scanIntervalMs ?? 30_000)) {
        changed = false;
        await scanSources(config, options, transport);
        lastScan = Date.now();
      }
      await delay(1000, undefined, { signal: options.signal });
    }
  } catch (error) { if (!options.signal?.aborted) throw error; }
  finally { for (const watcher of watchers) watcher.close(); }
}

export async function readWorkerConfig(path: string): Promise<WorkerConfig> {
  try { return validateConfig(JSON.parse(await readFile(path, "utf8")), dirname(resolve(path))); }
  catch (error) { if (error instanceof ImportError) throw error; throw new ImportError("WORKER_CONFIG_UNREADABLE"); }
}
