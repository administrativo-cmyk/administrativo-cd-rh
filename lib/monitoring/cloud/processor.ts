import { batchesFor } from "../ingestion/batches.ts";
import { ingestionParserVersion, parseSnapshot } from "../ingestion/parsers.ts";
import type { IngestBatch, IngestBatchResponse, IngestionSource } from "../ingestion/types.ts";
import { ImportError, sha256 } from "../ingestion/validation.ts";
import { httpBodyLimitBytes } from "../payload-limits.ts";
import { z } from "zod";

export const cloudSnapshotLimitBytes = 20 * 1024 * 1024;
export const cloudRoundBudgetMs = 230_000;
const batchSize = 500;
const minimumBatchBudgetMs = 5_000;

export type CloudFrozenSource = Readonly<Pick<IngestionSource,
  "id" | "kind" | "timeZone" | "identityNamespace" | "sourceIdentityConfirmed" | "afdProfile" | "afdIdentityType" | "encoding" | "declaredCoverage"
>>;

export interface CloudBatchPlan {
  version: 1;
  parserVersion: string;
  batchSize: 500;
  bodyLimitBytes: number;
  totalBatches: number;
  occurrenceCount: number;
  /** SHA256 of ordered SHA256(JSON.stringify(batch)) values joined with LF. */
  layoutHash: string;
}

export const cloudBatchPlanSchema = z.object({
  version: z.literal(1), parserVersion: z.string().min(1).max(100), batchSize: z.literal(500),
  bodyLimitBytes: z.literal(4_400_000), totalBatches: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  occurrenceCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), layoutHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export interface CloudSnapshotJob {
  id: string;
  source: CloudFrozenSource;
  sha256: string;
  byteLength: number;
  fileName: string;
  parserVersion: string;
  nextBatch: number;
  plan?: CloudBatchPlan | null;
}

export interface CloudPersistContext {
  jobId: string;
  expectedCursor: number;
  nextCursor: number;
  plan: CloudBatchPlan;
  signal: AbortSignal;
  deadline: number;
}

export interface CloudProcessorOptions {
  /** Must fence the lease and commit ingestion + plan + cursor in one transaction. */
  persist(batch: IngestBatch, context: CloudPersistContext): Promise<IngestBatchResponse>;
  signal?: AbortSignal;
  /** Absolute Unix milliseconds. The processor also caps the round at 230 seconds. */
  deadline: number;
  maxBatches?: number;
}

export interface CloudProcessorResult {
  status: "complete" | "pending";
  nextBatch: number;
  plan: CloudBatchPlan;
  processedBatches: number;
  /** References are preserved as evidence; this processor never resolves external photos. */
  photoReferences: number;
}

function frozenSource(input: CloudFrozenSource): IngestionSource {
  if (!input || typeof input.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.id)
    || !["afd", "defense-access", "defense-person"].includes(input.kind) || typeof input.timeZone !== "string"
    || (input.identityNamespace !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.identityNamespace))
    || (input.sourceIdentityConfirmed !== undefined && typeof input.sourceIdentityConfirmed !== "boolean")
    || (input.afdIdentityType !== undefined && !["cpf", "pis"].includes(input.afdIdentityType))
    || (input.encoding !== undefined && !["utf8", "latin1"].includes(input.encoding))) throw new ImportError("CLOUD_SOURCE_INVALID");
  try { new Intl.DateTimeFormat("en", { timeZone: input.timeZone }); }
  catch { throw new ImportError("INVALID_SOURCE_TIME_ZONE"); }
  const coverage = input.declaredCoverage;
  if (coverage !== undefined && (!coverage || typeof coverage.continuous !== "boolean"
    || !Number.isFinite(Date.parse(coverage.from)) || !Number.isFinite(Date.parse(coverage.to))
    || Date.parse(coverage.to) <= Date.parse(coverage.from))) throw new ImportError("INVALID_DECLARED_COVERAGE");
  // Whitelist the parser configuration. No local root, photo root or URL is accepted.
  return { root: "", id: input.id, kind: input.kind, timeZone: input.timeZone, identityNamespace: input.identityNamespace,
    sourceIdentityConfirmed: input.sourceIdentityConfirmed, afdProfile: input.afdProfile, afdIdentityType: input.afdIdentityType, encoding: input.encoding,
    declaredCoverage: coverage ? { ...coverage } : undefined };
}

function samePlan(actual: CloudBatchPlan, expected: CloudBatchPlan): boolean {
  return expected.version === actual.version && expected.parserVersion === actual.parserVersion
    && expected.batchSize === actual.batchSize && expected.bodyLimitBytes === actual.bodyLimitBytes
    && expected.totalBatches === actual.totalBatches && expected.occurrenceCount === actual.occurrenceCount
    && expected.layoutHash === actual.layoutHash;
}

/** Filesystem-free processing. The database checkpoint, not this return value, is authoritative after an interrupted response. */
export async function processCloudSnapshot(job: CloudSnapshotJob, input: Buffer, options: CloudProcessorOptions): Promise<CloudProcessorResult> {
  const startedAt = Date.now();
  const maxBatches = options.maxBatches ?? 10;
  if (!Number.isSafeInteger(options.deadline) || options.deadline < 0 || !Number.isInteger(maxBatches)
    || maxBatches < 1 || maxBatches > 100) throw new ImportError("CLOUD_PROCESSOR_OPTIONS_INVALID");
  const deadline = Math.min(options.deadline, startedAt + cloudRoundBudgetMs);
  const controller = new AbortController();
  const checkRound = () => {
    if (options.signal?.aborted) throw new ImportError("CLOUD_ROUND_ABORTED");
    if (Date.now() >= deadline) throw new ImportError("CLOUD_ROUND_DEADLINE_EXCEEDED");
  };
  checkRound();
  if (!Buffer.isBuffer(input) || input.length > cloudSnapshotLimitBytes) throw new ImportError("CLOUD_SNAPSHOT_TOO_LARGE");
  if (!job || typeof job.id !== "string" || !job.id || job.id.length > 100 || typeof job.fileName !== "string"
    || job.fileName.length < 1 || job.fileName.length > 255 || job.fileName.trim() !== job.fileName
    || /[\\/\u0000-\u001f\u007f]/.test(job.fileName) || [".", ".."].includes(job.fileName)
    || !Number.isSafeInteger(job.byteLength) || job.byteLength <= 0 || job.byteLength !== input.length
    || typeof job.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(job.sha256)
    || !Number.isSafeInteger(job.nextBatch) || job.nextBatch < 0) throw new ImportError("CLOUD_JOB_INVALID");
  const source = frozenSource(job.source);
  if (job.parserVersion !== ingestionParserVersion(source)) throw new ImportError("CLOUD_PARSER_VERSION_CHANGED");
  if (job.nextBatch > 0 && !job.plan) throw new ImportError("CLOUD_BATCH_PLAN_REQUIRED");
  if (job.plan && !cloudBatchPlanSchema.safeParse(job.plan).success) throw new ImportError("CLOUD_BATCH_PLAN_CHANGED");
  // Snapshot the supplied bytes before an asynchronous XLSX parser can yield to its caller.
  const bytes = Buffer.from(input);
  if (sha256(bytes) !== job.sha256) throw new ImportError("CLOUD_SNAPSHOT_HASH_MISMATCH");
  checkRound();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
  if (options.signal?.aborted) abort();
  try {
    checkRound();
    const parsed = await parseSnapshot(bytes, source);
    checkRound();
    // Local folder scans skip other AFD profiles; an explicitly uploaded file must fail visibly.
    if (parsed.skipped) throw new ImportError("CLOUD_AFD_PROFILE_MISMATCH");
    if (parsed.parserVersion !== job.parserVersion) throw new ImportError("CLOUD_PARSER_VERSION_CHANGED");
    const batches = batchesFor(parsed, source, job.fileName, batchSize);
    const hashes: string[] = [];
    for (const batch of batches) { checkRound(); hashes.push(sha256(JSON.stringify(batch))); }
    const plan: CloudBatchPlan = { version: 1, parserVersion: parsed.parserVersion, batchSize,
      bodyLimitBytes: httpBodyLimitBytes, totalBatches: batches.length, occurrenceCount: parsed.occurrences.length,
      layoutHash: sha256(hashes.join("\n")) };
    if (job.plan && !samePlan(plan, job.plan)) throw new ImportError("CLOUD_BATCH_PLAN_CHANGED");
    // The last commit may have succeeded before its response was lost. The frozen
    // plan and verified bytes permit finish to recheck this authoritative DB cursor.
    if (job.nextBatch > batches.length) throw new ImportError("CLOUD_BATCH_CURSOR_INVALID");
    let nextBatch = job.nextBatch; let processedBatches = 0;
    const photoReferences = parsed.occurrences.filter(row => row.person?.photoReference).length;
    while (nextBatch < batches.length && processedBatches < maxBatches) {
      checkRound();
      if (deadline - Date.now() < minimumBatchBudgetMs) break;
      const batch = batches[nextBatch];
      const response = await options.persist(batch, { jobId: job.id, expectedCursor: nextBatch, nextCursor: nextBatch + 1, plan, signal: controller.signal, deadline });
      if (!response || response.accepted !== true) throw new ImportError("INGEST_BATCH_NOT_ACKNOWLEDGED");
      if (response.fileStatus === "failed" || (batch.batch.final && response.fileStatus !== "complete" && response.fileStatus !== "conflict")) throw new ImportError("INGEST_FILE_NOT_COMPLETE");
      nextBatch++; processedBatches++;
    }
    return { status: nextBatch === batches.length ? "complete" : "pending", nextBatch, plan, processedBatches, photoReferences };
  } catch (error) {
    checkRound();
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
