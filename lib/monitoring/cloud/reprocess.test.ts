import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), calculate: vi.fn() }));
vi.mock("@/lib/monitoring/server", () => ({ workerClient: () => ({ rpc: (name: string, args: unknown) => ({ abortSignal: () => mocks.rpc(name, args) }) }) }));
vi.mock("@/lib/monitoring/reprocess", () => ({ buildReprocessResults: mocks.calculate }));
vi.mock("./server", () => ({ CloudError: class extends Error {} }));
import { reprocessCloudDays } from "./reprocess";
const employeeId = "30000000-0000-4000-8000-000000000001";
beforeEach(() => {
 vi.clearAllMocks(); vi.stubEnv("MONITORING_INGEST_SOURCE_IDS", "clock,clock");
 mocks.calculate.mockReturnValue([{ employeeId, date: "2026-10-02", version: 1, ruleVersion: "test", result: {}, summary: {} }]);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("bounded cloud attendance backfill", () => {
 it("continues beyond thirty days while time remains, with no unused leases", async () => {
  let claims = 0; let finishes = 0;
  mocks.rpc.mockImplementation(async (_name, args) => {
   if (args.p_action === "finish") { finishes++; return { error: null }; }
   claims++;
   return { data: { pending: Math.max(0, 200 - finishes), jobs: finishes < 200 ? [{ employeeId, date: "2026-10-02", reason: "Revisão da chamada", leaseToken: "40000000-0000-4000-8000-000000000001", input: {} }] : [] } };
  });
  const result = await reprocessCloudDays(new AbortController().signal, Date.now() + 230_000);
  expect(result).toMatchObject({ processed: 200, failed: 0 }); expect(finishes).toBe(200); expect(claims).toBe(201);
  expect(mocks.rpc.mock.calls[0][1].p_data).toEqual({ sourceIds: ["clock"], limit: 1 });
 });
 it("stops claiming before the deadline while finishing every claimed day", async () => {
  let now = 0; let claims = 0; let finishes = 0; vi.spyOn(Date, "now").mockImplementation(() => now);
  mocks.rpc.mockImplementation(async (_name, args) => {
   if (args.p_action === "finish") { finishes++; now += 20_000; return { error: null }; }
   claims++; return { data: { pending: 1000, jobs: [{ employeeId, date: "2026-10-02", reason: "Revisão da chamada", leaseToken: "40000000-0000-4000-8000-000000000001", input: {} }] } };
  });
  const result = await reprocessCloudDays(new AbortController().signal, 230_000);
  expect(result.processed).toBeGreaterThan(0); expect(result.processed).toBeLessThan(30); expect(claims).toBe(finishes); expect(now).toBeLessThan(230_000);
 });
});
