import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), calculate: vi.fn() }));
vi.mock("@/lib/monitoring/server", () => ({
  workerClient: () => ({ rpc: mocks.rpc }), boundedJson: (request: Request) => request.json(),
  monitoringFailure: () => Response.json({ error: "Falha controlada" }, { status: 503 }),
}));
vi.mock("@/lib/monitoring/reprocess", () => ({ buildReprocessResults: mocks.calculate }));
import { POST } from "./route";

const token = "synthetic-worker-token-with-more-than-32-characters";
const employeeId = "30000000-0000-4000-8000-000000000001";
const leaseToken = "40000000-0000-4000-8000-000000000001";
const job = { employeeId, date: "2026-10-05", leaseToken, reason: "Dados ou regras alterados", input: { version: 9 } };
function request(body: unknown = { sourceIds: ["rep"], limit: 10 }, authorization = `Bearer ${token}`) {
  return new Request("http://localhost/api/monitoring/ingest/reprocess", { method: "POST", headers: { "Content-Type": "application/json", Authorization: authorization }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MONITORING_INGEST_TOKEN", token);
  vi.stubEnv("MONITORING_INGEST_SOURCE_IDS", "rep,defense");
  mocks.rpc.mockImplementation(async (_name: string, data: { p_action: string }) => data.p_action === "claim" ? { data: { jobs: [job], pending: 4 }, error: null } : { data: { ok: true }, error: null });
  mocks.calculate.mockReturnValue([{ employeeId, date: job.date, version: 9, ruleVersion: "monitoring-1.0.0", result: {}, summary: { quality: "unavailable" } }]);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("worker de apuração por lease", () => {
  it("nega token ausente/incorreto sem acessar fila", async () => {
    expect((await POST(request(undefined, "Bearer wrong"))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("nega qualquer fonte fora da allowlist", async () => {
    expect((await POST(request({ sourceIds: ["rep", "foreign"] }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("limita lote a dez jobs", async () => {
    expect((await POST(request({ sourceIds: ["rep"], limit: 11 }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("conclui resultado indisponível honesto e retorna somente contagens", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 1, pending: 3, failed: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith("monitoring_worker", { p_action: "finish", p_data: expect.objectContaining({ leaseToken, version: 9, actor: null, summary: { quality: "unavailable" } }) });
  });
  it("CAS ou lease perdido retorna retry sanitizado", async () => {
    mocks.rpc.mockImplementation(async (_name: string, data: { p_action: string }) => data.p_action === "claim" ? { data: { jobs: [job], pending: 1 }, error: null }
      : data.p_action === "finish" ? { data: null, error: { message: "MONITORING_STALE_INPUT; private details" } } : { data: { ok: true }, error: null });
    const response = await POST(request());
    expect(await response.json()).toEqual({ processed: 0, pending: 1, failed: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("monitoring_worker", { p_action: "retry", p_data: { employeeId, date: job.date, leaseToken, code: "MONITORING_STALE_INPUT" } });
  });
  it("erro de payload não expõe conteúdo pessoal no retry", async () => {
    mocks.calculate.mockImplementation(() => { throw new Error("SENSITIVE_SOURCE_PAYLOAD"); });
    const response = await POST(request());
    expect(await response.json()).toEqual({ processed: 0, pending: 4, failed: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("monitoring_worker", { p_action: "retry", p_data: { employeeId, date: job.date, leaseToken, code: "MONITORING_REPROCESS_FAILED" } });
  });
});
