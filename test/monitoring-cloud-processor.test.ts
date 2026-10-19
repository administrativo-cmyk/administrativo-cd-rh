import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudRoundBudgetMs, cloudSnapshotLimitBytes, processCloudSnapshot, type CloudFrozenSource, type CloudPersistContext, type CloudSnapshotJob } from "../lib/monitoring/cloud/processor.ts";
import { batchesFor } from "../lib/monitoring/ingestion/batches.ts";
import { ingestionParserVersion, parseSnapshot } from "../lib/monitoring/ingestion/parsers.ts";
import type { IngestBatch, IngestBatchResponse } from "../lib/monitoring/ingestion/types.ts";
import { sha256 } from "../lib/monitoring/ingestion/validation.ts";

const source: CloudFrozenSource = { id: "synthetic-cloud-clock", kind: "afd", timeZone: "America/Sao_Paulo", afdProfile: "iso", identityNamespace: "synthetic-clock", sourceIdentityConfirmed: true };
const bytesFor = (count = 1) => Buffer.from(Array.from({ length: count }, (_, index) => `${String(index + 1).padStart(9, "0")}32026-10-17T08:00:00-0300012345678909ABCD`).join("\r\n"));
const jobFor = (bytes: Buffer, frozen = source): CloudSnapshotJob => ({ id: "synthetic-job", source: frozen, sha256: sha256(bytes), byteLength: bytes.length, fileName: frozen.kind === "afd" ? "synthetic.txt" : "synthetic.xlsx", parserVersion: ingestionParserVersion(frozen), nextBatch: 0 });
const accepted = async (batch: IngestBatch): Promise<IngestBatchResponse> => ({ accepted: true, fileStatus: batch.batch.final ? "complete" : "processing" });
const options = () => ({ deadline: Date.now() + 240_000, persist: vi.fn(accepted) });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("cloud snapshot batches and checkpoints", () => {
  it("uses exactly the local payloads and resumes only the next confirmed batch", async () => {
    const bytes = bytesFor(501); const job = jobFor(bytes); const persist = vi.fn(accepted);
    const first = await processCloudSnapshot(job, bytes, { ...options(), persist, maxBatches: 1 });
    expect(first).toMatchObject({ status: "pending", nextBatch: 1, processedBatches: 1, photoReferences: 0 });
    const expected = batchesFor(await parseSnapshot(bytes, { ...source, root: "." }), { ...source, root: "." }, job.fileName);
    expect(persist.mock.calls[0][0]).toEqual(expected[0]);
    expect(first.plan).toEqual({ version: 1, parserVersion: ingestionParserVersion(source), batchSize: 500, bodyLimitBytes: 4_400_000,
      totalBatches: 2, occurrenceCount: 501, layoutHash: sha256(expected.map(batch => sha256(JSON.stringify(batch))).join("\n")) });
    const second = await processCloudSnapshot({ ...job, nextBatch: first.nextBatch, plan: first.plan }, bytes, { ...options(), persist });
    expect(second).toMatchObject({ status: "complete", nextBatch: 2, processedBatches: 1, plan: first.plan });
    expect(persist.mock.calls.map(([batch]) => batch)).toEqual(expected);
  });

  it("provides an atomic expected/next cursor, bounded deadline and signal to the adapter", async () => {
    const bytes = bytesFor(); const startedAt = Date.now(); let context: CloudPersistContext | undefined;
    await processCloudSnapshot(jobFor(bytes), bytes, { deadline: startedAt + 600_000, persist: async (batch, value) => { context = value; return accepted(batch); } });
    expect(context).toMatchObject({ jobId: "synthetic-job", expectedCursor: 0, nextCursor: 1 });
    expect(context!.deadline).toBeLessThanOrEqual(startedAt + cloudRoundBudgetMs + 100);
    expect(context!.signal.aborted).toBe(false);
  });

  it("rejects a changed plan, parser, source envelope, filename or unplanned cursor before persistence", async () => {
    const bytes = bytesFor(501); const job = jobFor(bytes);
    const first = await processCloudSnapshot(job, bytes, { ...options(), maxBatches: 1 });
    const cases: Array<[Partial<CloudSnapshotJob>, string]> = [
      [{ plan: { ...first.plan, layoutHash: "0".repeat(64) } }, "CLOUD_BATCH_PLAN_CHANGED"],
      [{ plan: { ...first.plan, batchSize: 499 } as unknown as typeof first.plan }, "CLOUD_BATCH_PLAN_CHANGED"],
      [{ parserVersion: "unsupported-version" }, "CLOUD_PARSER_VERSION_CHANGED"],
      [{ source: { ...source, identityNamespace: "different-namespace" } }, "CLOUD_BATCH_PLAN_CHANGED"],
      [{ fileName: "renamed.txt" }, "CLOUD_BATCH_PLAN_CHANGED"],
      [{ nextBatch: 1, plan: undefined }, "CLOUD_BATCH_PLAN_REQUIRED"],
      [{ nextBatch: 3 }, "CLOUD_BATCH_CURSOR_INVALID"],
    ];
    for (const [change, code] of cases) {
      const run = options();
      await expect(processCloudSnapshot({ ...job, nextBatch: 1, plan: first.plan, ...change }, bytes, run)).rejects.toMatchObject({ code });
      expect(run.persist).not.toHaveBeenCalled();
    }
  });

  it("replays an unacknowledged attempt with identical bytes and no inferred cursor advancement", async () => {
    const bytes = bytesFor(); const job = jobFor(bytes); const sent: IngestBatch[] = [];
    await expect(processCloudSnapshot(job, bytes, { ...options(), persist: async batch => { sent.push(batch); throw new Error("synthetic network interruption"); } })).rejects.toThrow("synthetic network interruption");
    const result = await processCloudSnapshot(job, bytes, { ...options(), persist: async batch => { sent.push(batch); return accepted(batch); } });
    expect(sent[0]).toEqual(sent[1]); expect(job.nextBatch).toBe(0); expect(result.status).toBe("complete");
  });

  it("finishes from the verified database cursor after the final commit response was lost", async () => {
    const bytes = bytesFor(); const job = jobFor(bytes); let committed: CloudPersistContext | undefined;
    await expect(processCloudSnapshot(job, bytes, { ...options(), persist: async (_batch, context) => { committed = context; throw new Error("synthetic response lost after commit"); } })).rejects.toThrow("synthetic response lost after commit");
    const run = options();
    const result = await processCloudSnapshot({ ...job, nextBatch: committed!.nextCursor, plan: committed!.plan }, bytes, run);
    expect(result).toMatchObject({ status: "complete", nextBatch: 1, processedBatches: 0, plan: committed!.plan });
    expect(run.persist).not.toHaveBeenCalled();
  });

  it("requires a completion acknowledgment and preserves conflict as an explicit completed import", async () => {
    const bytes = bytesFor(); const job = jobFor(bytes);
    for (const response of [{ accepted: false }, { accepted: true, fileStatus: "processing" }, { accepted: true, fileStatus: "failed" }] as IngestBatchResponse[]) {
      await expect(processCloudSnapshot(job, bytes, { ...options(), persist: async () => response })).rejects.toMatchObject({ code: response.accepted ? "INGEST_FILE_NOT_COMPLETE" : "INGEST_BATCH_NOT_ACKNOWLEDGED" });
    }
    expect((await processCloudSnapshot(job, bytes, { ...options(), persist: async () => ({ accepted: true, fileStatus: "conflict" }) })).status).toBe("complete");
  });
});

describe("cloud snapshot input and cancellation", () => {
  it("rejects an AFD from another profile instead of marking an empty import complete", async () => {
    const bytes = bytesFor(); const run = options();
    await expect(processCloudSnapshot(jobFor(bytes, { ...source, afdProfile: "legacy" }), bytes, run)).rejects.toMatchObject({ code: "CLOUD_AFD_PROFILE_MISMATCH" });
    expect(run.persist).not.toHaveBeenCalled();
  });

  it("checks the 20 MiB bound, declared bytes and immutable hash before parsing", async () => {
    const oversized = Buffer.alloc(cloudSnapshotLimitBytes + 1); const invalid = Buffer.from("not an AFD"); const run = options();
    await expect(processCloudSnapshot(jobFor(oversized), oversized, run)).rejects.toMatchObject({ code: "CLOUD_SNAPSHOT_TOO_LARGE" });
    await expect(processCloudSnapshot({ ...jobFor(invalid), byteLength: invalid.length + 1 }, invalid, run)).rejects.toMatchObject({ code: "CLOUD_JOB_INVALID" });
    await expect(processCloudSnapshot({ ...jobFor(invalid), sha256: "0".repeat(64) }, invalid, run)).rejects.toMatchObject({ code: "CLOUD_SNAPSHOT_HASH_MISMATCH" });
    expect(run.persist).not.toHaveBeenCalled();
  });

  it("refuses path-like names and unknown parser profiles without reading a filesystem", async () => {
    const bytes = bytesFor(); const run = options();
    for (const fileName of ["../file.txt", "folder\\file.txt", "\u0000.txt", "..", " file.txt"]) await expect(processCloudSnapshot({ ...jobFor(bytes), fileName }, bytes, run)).rejects.toMatchObject({ code: "CLOUD_JOB_INVALID" });
    expect(() => ingestionParserVersion({ kind: "afd" })).toThrow("INVALID_AFD_PROFILE");
    expect(run.persist).not.toHaveBeenCalled();
  });

  it("rejects cancellation and expired deadlines before parsing malformed bytes", async () => {
    const bytes = Buffer.from("not an AFD"); const controller = new AbortController(); controller.abort("private caller reason"); const run = options();
    await expect(processCloudSnapshot(jobFor(bytes), bytes, { ...run, signal: controller.signal })).rejects.toMatchObject({ message: "CLOUD_ROUND_ABORTED" });
    await expect(processCloudSnapshot(jobFor(bytes), bytes, { ...run, deadline: Date.now() })).rejects.toMatchObject({ code: "CLOUD_ROUND_DEADLINE_EXCEEDED" });
    expect(run.persist).not.toHaveBeenCalled();
  });

  it("stops between batches after an external abort and forwards it to the adapter signal", async () => {
    const bytes = bytesFor(501); const controller = new AbortController(); let signal: AbortSignal | undefined;
    const persist = vi.fn(async (batch: IngestBatch, context: CloudPersistContext) => { signal = context.signal; controller.abort("private reason"); return accepted(batch); });
    await expect(processCloudSnapshot(jobFor(bytes), bytes, { ...options(), signal: controller.signal, persist })).rejects.toMatchObject({ code: "CLOUD_ROUND_ABORTED" });
    expect(persist).toHaveBeenCalledTimes(1); expect(signal?.aborted).toBe(true);
  });

  it("returns pending before starting a new batch when only the safety margin remains", async () => {
    vi.useFakeTimers(); const startedAt = Date.now(); const bytes = bytesFor(501); const persist = vi.fn(async (batch: IngestBatch) => { vi.setSystemTime(startedAt + cloudRoundBudgetMs - 4_000); return accepted(batch); });
    const result = await processCloudSnapshot(jobFor(bytes), bytes, { deadline: startedAt + 600_000, persist });
    expect(result).toMatchObject({ status: "pending", processedBatches: 1, nextBatch: 1 });
    expect(persist).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an in-flight adapter at the deadline without renewing the round", async () => {
    vi.useFakeTimers(); const bytes = bytesFor(); const startedAt = Date.now(); let adapterStarted!: () => void;
    const ready = new Promise<void>(resolve => { adapterStarted = resolve; });
    const persist = vi.fn((_batch: IngestBatch, context: CloudPersistContext) => new Promise<IngestBatchResponse>((_resolve, reject) => { context.signal.addEventListener("abort", () => reject(new Error("adapter aborted")), { once: true }); adapterStarted(); }));
    const pending = processCloudSnapshot(jobFor(bytes), bytes, { deadline: startedAt + 6_000, persist });
    const rejected = expect(pending).rejects.toMatchObject({ code: "CLOUD_ROUND_DEADLINE_EXCEEDED" });
    await ready; await vi.advanceTimersByTimeAsync(6_000); await rejected;
    expect(persist).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it("imports Person references as evidence without resolving photos or local paths", async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Cadastro");
    sheet.addRow(["Nome", "ID", "Grupo de pessoas", "Imagem de rosto 1"]);
    sheet.addRow(["Pessoa sintética", "0001", "All/CD/Operação", { text: "0001.jpg", hyperlink: "0001.jpg" }]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer()); const run = options();
    const result = await processCloudSnapshot(jobFor(bytes, { ...source, kind: "defense-person", afdProfile: undefined }), bytes, run);
    expect(result).toMatchObject({ status: "complete", photoReferences: 1 });
    expect(run.persist.mock.calls[0][0].occurrences[0].person).toMatchObject({ externalId: "0001", photoReference: "0001.jpg" });
    expect(run.persist.mock.calls[0][0].source).not.toHaveProperty("root");
    expect(result.plan.parserVersion).toBe("monitoring-import/1.0.0/defense-person");
  });
});
