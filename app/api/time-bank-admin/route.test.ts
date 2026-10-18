import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/dashboards/server", () => ({ dashboardSession: mocks.session }));
vi.mock("@/lib/time-bank-admin/server", async (load) => ({ ...await load<typeof import("@/lib/time-bank-admin/server")>(), bankAdminQuery: mocks.query }));
import { GET, POST } from "./route";
const id = "bc000000-0000-4000-8000-000000000001";
const row = { id, employeeId: id, employeeName: "Pessoa sintética", employeeNumber: "0001", unit: "CD I", measurementDate: "2026-10-01", effectiveFrom: "2026-10-01", workdayHours: 8, balanceMinutes: -60, source: null, importBatchId: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", cancelledAt: null };
const input = { employeeId: id, measurementDate: row.measurementDate, effectiveFrom: row.effectiveFrom, workdayHours: 8, balanceMinutes: -60, reason: "Conferência teste" };
const request = (data: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/time-bank-admin", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(data) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "development"); mocks.session.mockResolvedValue({ userId: id, role: "ADMIN" }); mocks.query.mockResolvedValue({ record: row, changed: true, queued: 0 }); });
afterEach(() => vi.unstubAllEnvs());
describe("API de medições", () => {
  it("nega origem externa antes da sessão e escrita", async () => {
    expect((await POST(request({ action: "save", data: input }, "https://other.example"))).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each(["GESTOR", "LEITURA"])("nega%s em leitura e escrita administrativa", async (role) => {
    mocks.session.mockResolvedValue({ userId: id, role });
    expect((await GET(new Request("http://localhost/api/time-bank-admin"))).status).toBe(403);
    expect((await POST(request({ action: "save", data: input }))).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("repassa ausência de sessão sem fonte", async () => {
    mocks.session.mockResolvedValue({ response: Response.json({}, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/time-bank-admin"))).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("aceita RH, preserva sinal e valida resposta de gravação", async () => {
    mocks.session.mockResolvedValue({ userId: id, role: "RH" });
    const response = await POST(request({ action: "save", data: input }));
    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith("save", expect.objectContaining({ balanceMinutes: -60 }));
    mocks.query.mockResolvedValue(null);
    expect((await POST(request({ action: "save", data: input }))).status).toBe(503);
  });
  it("exige CAS, motivo e dados válidos antes da RPC", async () => {
    for (const data of [{ ...input, id }, { ...input, reason: "" }, { ...input, balanceMinutes: 0.1 }, { ...input, effectiveFrom: "2026-02-30" }, { ...input, createdBy: id }]) expect((await POST(request({ action: "save", data }))).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("lista tempagina limitada e histórico exigeID", async () => {
    mocks.query.mockResolvedValue({ rows: [], total: 0, employees: [] });
    const response = await GET(new Request("http://localhost/api/time-bank-admin?limit=25&state=cancelled"));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.query).toHaveBeenCalledWith("list", expect.objectContaining({ limit: 25, state: "cancelled" }));
    expect((await GET(new Request("http://localhost/api/time-bank-admin?limit=201"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/time-bank-admin?action=history"))).status).toBe(400);
  });
  it("conflito devolve409 e falha interna não vaza mensagem", async () => {
    mocks.query.mockRejectedValue(Object.assign(new Error("secret"), { code: "BANK_ADMIN_STALE" }));
    expect((await POST(request({ action: "save", data: input }))).status).toBe(409);
    mocks.query.mockRejectedValue(new Error("secret"));
    const response = await POST(request({ action: "save", data: input }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
});
