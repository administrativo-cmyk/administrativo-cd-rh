import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), rpc: vi.fn(), trusted: vi.fn(), calculate: vi.fn() }));
vi.mock("@/lib/monitoring/server", () => ({
  monitoringSession: mocks.session, monitoringQuery: mocks.query,
  workerClient: () => ({ rpc: mocks.rpc }), boundedJson: (request: Request) => request.json(),
  monitoringFailure: () => Response.json({ error: "Falha controlada" }, { status: 503 }),
}));
vi.mock("@/lib/security/mutation-origin", () => ({ isTrustedMutationOrigin: mocks.trusted }));
vi.mock("@/lib/monitoring/reprocess", async (original) => ({ ...await original<typeof import("@/lib/monitoring/reprocess")>(), reprocessMonitoringSnapshot: mocks.calculate }));
import { POST } from "./route";

const employeeId = "30000000-0000-4000-8000-000000000001";
const actor = "20000000-0000-4000-8000-000000000001";
function request(patch: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/monitoring/reprocess", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ employeeId, start: "2026-10-05", end: "2026-10-05", reason: "Reprocessamento solicitado", ...patch }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.trusted.mockReturnValue(true);
  mocks.session.mockResolvedValue({ userId: actor });
  mocks.query.mockResolvedValue({ version: 7 });
  mocks.calculate.mockReturnValue([{ employeeId, date: "2026-10-05", version: 7, ruleVersion: "monitoring-1.0.0", result: { issues: [] }, summary: { quality: "partial" } }]);
  mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe("POST reprocessamento autorizado", () => {
  it("requer origem confiável antes de ler snapshot ou gravar", async () => {
    mocks.trusted.mockReturnValue(false);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([401, 403])("retém bloqueio de sessão/perfil (%i)", async (status) => {
    mocks.session.mockResolvedValue({ response: Response.json({ error: "Bloqueado" }, { status }) });
    expect((await POST(request())).status).toBe(status);
    expect(mocks.session).toHaveBeenCalledWith(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("valida período antes de acessar banco", async () => {
    expect((await POST(request({ end: "2026-12-31" }))).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("persiste versão exata do snapshot e autor autenticado", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith("input", { employeeId, start: "2026-10-05", end: "2026-10-05" });
    expect(mocks.rpc).toHaveBeenCalledWith("monitoring_save_result", { p_data: expect.objectContaining({ employeeId, version: 7, actor, reason: "Reprocessamento solicitado" }) });
    expect(await response.json()).toMatchObject({ ok: true, saved: 1, version: 7 });
  });
  it("retorna conflito quando CAS detecta insumo alterado", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "MONITORING_STALE_INPUT" } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ saved: 0 });
  });
  it("expõe configuração ambígua como ação necessária sem gravar", async () => {
    mocks.calculate.mockImplementation(() => { throw new Error("MONITORING_CONFIGURATION_CONFLICT"); });
    expect((await POST(request())).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
