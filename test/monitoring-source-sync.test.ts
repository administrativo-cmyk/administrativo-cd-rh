import { describe, expect, it, vi, afterEach } from "vitest";
import { scanSources, validateConfig } from "../lib/monitoring/ingestion/worker.ts";
import { createHttpTransport } from "../lib/monitoring/ingestion/transport.ts";
import type { IngestionTransport, ManagedWorkerSource, WorkerConfig } from "../lib/monitoring/ingestion/types.ts";
const source: ManagedWorkerSource = { id: "test-clock", kind: "afd", timeZone: "America/Sao_Paulo", identityNamespace: "test-clock", active: true, configurationUpdatedAt: "2026-10-17T00:00:00Z", sourceIdentityConfirmed: false, declaredCoverage: null };
const config: WorkerConfig = { version: 1, stateDirectory: "nonexistent-synthetic-state", sources: [{ id: source.id, kind: source.kind, root: "nonexistent-synthetic-folder", timeZone: source.timeZone }] };
afterEach(() => vi.unstubAllGlobals());
describe("local source authorization and remote disable", () => {
  it.each(["disabled", "missing", "mismatch"] as const)("does not read the folder or heartbeat when metadata is %s", async mode => {
    const heartbeat = vi.fn(); const persist = vi.fn(); const reprocess = vi.fn();
    const transport: IngestionTransport = { heartbeat, persist, reprocess, sources: async () => ({ sources: mode === "missing" ? [] : [{ ...source, active: mode !== "disabled", identityNamespace: mode === "mismatch" ? "different" : source.identityNamespace }] }) };
    const [result] = await scanSources(config, { apply: true }, transport);
    expect(result.files).toBe(0); expect(heartbeat).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled(); expect(reprocess).not.toHaveBeenCalled();
    expect(result.issueCounts).toHaveProperty({ disabled: "SOURCE_DISABLED", missing: "SOURCE_NOT_REGISTERED", mismatch: "SOURCE_LOCAL_CONTRACT_MISMATCH" }[mode]);
  });
  it("local enabled=false cannot be overridden by server metadata", async () => {
    const sources = vi.fn(async () => ({ sources: [] })); const heartbeat = vi.fn();
    const [result] = await scanSources({ ...config, sources: [{ ...config.sources[0], enabled: false }] }, { apply: true }, { sources, heartbeat, persist: vi.fn() });
    expect(sources).toHaveBeenCalledWith({ sourceIds: [] }); expect(result.issueCounts).toHaveProperty("SOURCE_DISABLED_LOCALLY"); expect(heartbeat).not.toHaveBeenCalled();
    expect(() => validateConfig({ ...config, sources: [{ ...config.sources[0], enabled: "false" }] }, ".")).toThrow("INVALID_SOURCE_CONFIG");
  });
  it("metadata request fails closed and strips paths returned by the server", async () => {
    const transport = createHttpTransport("http://localhost:3000/api/monitoring/ingest", "synthetic-token-".repeat(4));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ sources: [{ ...source, root: "unsafe", photoRoot: "unsafe" }] })));
    const result = await transport.sources!({ sourceIds: [source.id] }); expect(result.sources[0]).not.toHaveProperty("root"); expect(result.sources[0]).not.toHaveProperty("photoRoot");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ sources: [{ ...source, id: "unsolicited-source" }] })));
    await expect(transport.sources!({ sourceIds: [source.id] })).rejects.toThrow("SOURCE_METADATA_INVALID");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "denied" }, { status: 403 })));
    await expect(scanSources(config, { apply: true }, transport)).rejects.toThrow("INGEST_HTTP_403");
  });
});
