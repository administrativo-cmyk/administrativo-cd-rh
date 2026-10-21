import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudBatchPlan, CloudProcessorOptions, CloudSnapshotJob } from "../lib/monitoring/cloud/processor.ts";
import type { IngestBatch } from "../lib/monitoring/ingestion/types.ts";
import type { CloudJob } from "../lib/monitoring/cloud/server";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), download: vi.fn(), process: vi.fn(), reprocess: vi.fn(),archive:vi.fn(),retention:vi.fn() }));
vi.mock("@/lib/monitoring/archive/server",()=>({serverArchiveStore:()=>({})}));
vi.mock("@/lib/monitoring/archive/prepare-cloud",()=>({ensureArchivedSnapshot:mocks.archive}));
vi.mock("@/lib/monitoring/archive/retention",()=>({retainRecentMonths:mocks.retention}));
vi.mock("@/lib/monitoring/server", () => ({ workerClient: () => ({ rpc: (name: string, args: unknown) => ({ abortSignal: (signal: AbortSignal) => mocks.rpc(name, args, signal) }) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/monitoring/cloud/storage", () => ({ downloadCloudObject: mocks.download }));
vi.mock("@/lib/monitoring/cloud/reprocess", () => ({ reprocessCloudDays: mocks.reprocess }));
vi.mock("@/lib/monitoring/cloud/processor", async importOriginal => ({ ...await importOriginal<typeof import("../lib/monitoring/cloud/processor.ts")>(), processCloudSnapshot: mocks.process }));
import { POST } from "@/app/api/monitoring/cloud/run/route";
import { ImportError } from "../lib/monitoring/ingestion/validation.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = "a".repeat(64);
const bytes = Buffer.from("synthetic snapshot");
const job: CloudJob = { autoDetect: false,
  id: "80000000-0000-4000-8000-000000000001", sourceId: "cloud-test",
  source: { id: "cloud-test", kind: "afd", timeZone: "America/Sao_Paulo", identityNamespace: "cloud-test", sourceIdentityConfirmed: false, afdProfile: "iso" },
  fileName: "synthetic.txt", objectPath: "80000000-0000-4000-8000-000000000001/original", bucket: "monitoramento-originais",
  byteLength: bytes.length, sha256: hash(bytes.toString()), parserVersion: "monitoring-import/1.0.0/afd-iso", status: "processing",
  cursor: 0, processedRows: 0, totalRows: null, totalBatches: null, attempts: 1, maxAttempts: 5, nextRetryAt: null, lastError: null,
  createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z", completedAt: null,
  leaseToken: "80000000-0000-4000-8000-000000000002", leaseExpiresAt: "2026-10-19T00:05:00Z",
};
const plan: CloudBatchPlan = { version: 1, parserVersion: job.parserVersion, batchSize: 500, bodyLimitBytes: 4_400_000, totalBatches: 1, occurrenceCount: 0, layoutHash: hash("synthetic layout") };
const batch: IngestBatch = { protocolVersion: 1, source: { ...job.source, declaredCoverage: job.source.declaredCoverage ?? undefined },
  file: { sha256: job.sha256, byteLength: job.byteLength, parserVersion: job.parserVersion, relativePath: job.fileName, issues: [], observedRange: null, metadata: {} },
  batch: { index: 0, final: true, totalRows: 0, occurrenceCount: 0, totalBatches: 1 }, occurrences: [] };
const request = (authorization: string | null = `Bearer ${token}`, signal?: AbortSignal) => new Request("https://app.example/api/monitoring/cloud/run", { method: "POST", ...(authorization ? { headers: { authorization } } : {}), signal });
const actions = () => mocks.rpc.mock.calls.map(([, args]) => args.p_action);
const success = (data: unknown) => ({ data, error: null });
const defaultRpc = async (_name: string, args: { p_action: string }) => success(args.p_action === "claim" ? { job, reprocess: true } : args.p_action === "persist" ? { job: { ...job, cursor: 1 }, result: { accepted: true, fileStatus: "complete", newEvents: 0 } } : { job });

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("MONITORING_INGEST_SOURCE_IDS", "cloud-test");
  mocks.archive.mockResolvedValue({active:true});mocks.retention.mockResolvedValue({pending:false,archived:0});
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.rpc.mockImplementation(defaultRpc); mocks.download.mockResolvedValue(bytes); mocks.reprocess.mockResolvedValue({ processed: 0, pending: 0, failed: 0 });
  mocks.process.mockImplementation(async (_job: CloudSnapshotJob, _bytes: Buffer, options: CloudProcessorOptions) => {
    await options.persist(batch, { jobId: job.id, expectedCursor: 0, nextCursor: 1, plan, signal: options.signal!, deadline: options.deadline });
    return { status: "complete", nextBatch: 1, plan, processedBatches: 1, photoReferences: 0 };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("cloud runner orchestration", () => {
  it("blocks persistence until the private archive is verified and retries a transport interruption",async()=>{
    mocks.archive.mockRejectedValue(new Error("ARCHIVE_DOWNLOAD_FAILED"));
    const response=await POST(request());expect(await response.json()).toMatchObject({state:"retry",code:"ARCHIVE_DOWNLOAD_FAILED"});
    expect(mocks.process).not.toHaveBeenCalled();expect(actions()).toEqual(["claim","fail"]);
  });
  it("rejects malformed dispatches before any database call or download", async () => {
    for (const authorization of [null, "Bearer service-role-is-not-a-dispatch", `Bearer ${token} extra`]) {
      const result = await POST(request(authorization)); expect(result.status).toBe(401);
    }
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.reprocess).not.toHaveBeenCalled();
  });

  it("uses only the token hash and rejects an expired or reused dispatch before work", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PT401", message: "CLOUD_DISPATCH_INVALID" } });
    const result = await POST(request()); expect(result.status).toBe(401);
    expect(mocks.rpc).toHaveBeenCalledWith("monitoring_cloud_worker", { p_action: "claim", p_data: { tokenHash: hash(token) } }, expect.any(AbortSignal));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token);
    expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.reprocess).not.toHaveBeenCalled();
  });

  it("leaves an idle claim without reprocessing authorization completely idle", async () => {
    mocks.rpc.mockResolvedValue(success({ job: null, reprocess: false }));
    const response = await POST(request()); expect(await response.json()).toEqual({ accepted: true, state: "idle" });
    expect(actions()).toEqual(["claim"]); expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.reprocess).not.toHaveBeenCalled();
  });

  it("drains due days without requiring an upload job or an open browser", async () => {
    mocks.rpc.mockResolvedValue(success({ job: null, reprocess: true }));
    const response = await POST(request()); expect(await response.json()).toMatchObject({ accepted: true, state: "idle", reprocess: { processed: 0 } });
    expect(mocks.reprocess).toHaveBeenCalledTimes(1); expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled();
  });

  it("rejects a file hash mismatch without persistence, finish or day reprocessing", async () => {
    mocks.process.mockRejectedValue(new ImportError("CLOUD_SNAPSHOT_HASH_MISMATCH"));
    const response = await POST(request()); expect(await response.json()).toMatchObject({ state: "failed", code: "CLOUD_SNAPSHOT_HASH_MISMATCH" });
    expect(actions()).toEqual(["claim", "fail"]);
    expect(mocks.rpc.mock.calls[1][1].p_data).toEqual({ id: job.id, leaseToken: job.leaseToken, code: "CLOUD_SNAPSHOT_HASH_MISMATCH", retryable: false });
    expect(mocks.reprocess).not.toHaveBeenCalled();
  });

  it("enforces the server source allowlist before downloading an otherwise valid claimed job", async () => {
    vi.stubEnv("MONITORING_INGEST_SOURCE_IDS", "different-source");
    const response = await POST(request()); expect(await response.json()).toMatchObject({ state: "failed", code: "CLOUD_SOURCE_FORBIDDEN" });
    expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled(); expect(actions()).toEqual(["claim", "fail"]);
  });

  it("passes the frozen job and actual DB fileStatus into processing and finishes after completion", async () => {
    let acknowledgment: unknown;
    mocks.process.mockImplementation(async (received: CloudSnapshotJob, input: Buffer, options: CloudProcessorOptions) => {
      expect(received).toMatchObject({ id: job.id, parserVersion: job.parserVersion, nextBatch: 0, sha256: job.sha256, source: job.source });
      expect(input).toBe(bytes); expect(options.maxBatches).toBe(100);
      acknowledgment = await options.persist(batch, { jobId: job.id, expectedCursor: 0, nextCursor: 1, plan, signal: options.signal!, deadline: options.deadline });
      return { status: "complete", nextBatch: 1, plan, processedBatches: 1, photoReferences: 0 };
    });
    const response = await POST(request()); expect(await response.json()).toMatchObject({ state: "processed" });
    expect(acknowledgment).toEqual({ accepted: true, fileStatus: "complete", newEvents: 0 });
    expect(actions()).toEqual(["claim", "persist", "finish"]);
    expect(mocks.rpc.mock.calls[1][1].p_data).toEqual({ id: job.id, leaseToken: job.leaseToken, expectedCursor: 0, batch, plan });
    expect(mocks.reprocess).toHaveBeenCalledTimes(1);
  });

  it("releases a pending round for the next invocation and preserves its checkpoint plan", async () => {
    mocks.rpc.mockImplementation(async (name, args) => args.p_action === "claim" ? success({ job: { ...job, cursor: 1, plan }, reprocess: true }) : defaultRpc(name, args));
    mocks.process.mockResolvedValue({ status: "pending", nextBatch: 1, plan, processedBatches: 0, photoReferences: 0 });
    const response = await POST(request()); expect(await response.json()).toMatchObject({ state: "processed" });
    expect(mocks.process.mock.calls[0][0]).toMatchObject({ nextBatch: 1, plan }); expect(actions()).toEqual(["claim", "release"]);
    expect(mocks.rpc.mock.calls[1][1].p_data).toEqual({ id: job.id, leaseToken: job.leaseToken });
  });

  it.each(["40001", "40P01", "57014", "08006", "PGRST003", ""])("retries transient RPC code %s with the same fenced job", async code => {
    mocks.rpc.mockImplementation(async (name, args) => args.p_action === "persist" ? { data: null, error: { code, message: "synthetic transient backend detail" } } : defaultRpc(name, args));
    const response = await POST(request()); expect(await response.json()).toMatchObject({ state: "retry", code: "CLOUD_UNAVAILABLE" });
    expect(actions()).toEqual(["claim", "persist", "fail"]);
    expect(mocks.rpc.mock.calls[2][1].p_data).toEqual({ id: job.id, leaseToken: job.leaseToken, code: "CLOUD_UNAVAILABLE", retryable: true });
    expect(mocks.reprocess).not.toHaveBeenCalled();
  });

  it("does not classify a clock-expired budget as a permanent failure before the timeout signal fires", async () => {
    mocks.process.mockRejectedValue(new ImportError("CLOUD_ROUND_DEADLINE_EXCEEDED"));
    const response = await POST(request()); expect(await response.json()).toMatchObject({ state: "retry", code: "CLOUD_ROUND_DEADLINE_EXCEEDED" });
    expect(mocks.rpc.mock.calls[1][1].p_data.retryable).toBe(true);
  });

  it("rejects an explicitly unaccepted persistence response rather than finishing", async () => {
    mocks.rpc.mockImplementation(async (name, args) => args.p_action === "persist" ? success({ result: { accepted: false, fileStatus: "failed" } }) : defaultRpc(name, args));
    const response = await POST(request()); expect(await response.json()).toMatchObject({ state: "failed", code: "CLOUD_BATCH_REJECTED" });
    expect(actions()).toEqual(["claim", "persist", "fail"]);
  });

  it("keeps queue work alive when the scheduler HTTP connection is already closed", async () => {
    const disconnected = new AbortController(); disconnected.abort();
    const response = await POST(request(`Bearer ${token}`, disconnected.signal));
    expect(await response.json()).toMatchObject({ state: "processed" });
    const signal = mocks.process.mock.calls[0][2].signal as AbortSignal;
    expect(signal).not.toBe(disconnected.signal); expect(signal.aborted).toBe(false);
  });

  it("does not hide a finish connection failure and treats a lost failure fence as harmless", async () => {
    mocks.rpc.mockImplementation(async (name, args) => args.p_action === "finish" ? { data: null, error: { code: "08006", message: "private backend address" } }
      : args.p_action === "fail" ? { data: null, error: { code: "PT409", message: "CLOUD_LEASE_LOST" } } : defaultRpc(name, args));
    const response = await POST(request()); const body = await response.json();
    expect(body).toMatchObject({ state: "retry", code: "CLOUD_UNAVAILABLE" }); expect(JSON.stringify(body)).not.toContain("private backend address");
    expect(actions()).toEqual(["claim", "persist", "finish", "fail"]); expect(mocks.reprocess).not.toHaveBeenCalled();
  });
});
