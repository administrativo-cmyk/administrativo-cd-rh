import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), load: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/dashboards/server", () => ({ dashboardSession: mocks.session, loadDashboard: mocks.load, DashboardError: class extends Error { constructor(readonly code: string, readonly status: number) { super(code); } } }));
vi.mock("@/lib/security/operational-error", () => ({ reportOperationalError: mocks.report }));
import { GET } from "./route";
import { DashboardError } from "@/lib/dashboards/server";

const params = (domain = "chamada-diaria") => ({ params: Promise.resolve({ domain }) });
const request = (query = "start=2026-10-01&end=2026-10-17") => new Request(`http://localhost:3000/api/dashboards/chamada-diaria?${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: "session-user", role: "ADMIN" });
  mocks.report.mockReturnValue("test-correlation");
  mocks.load.mockResolvedValue({ domain: "chamada-diaria", title: "Chamada", description: "Dados reais", start: "2026-10-01", end: "2026-10-17", queriedAt: "2026-10-17T15:00:00Z", options: { units: [], managers: [] }, metrics: [], charts: [], table: { columns: [], rows: [] }, notes: [], operationHref: "/chamada-diaria" });
});
describe("GET dos dashboards protegidos", () => {
  it("aguarda params assíncronos e não oferece métodos de escrita", async () => {
    expect((await GET(request(), params())).status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith("chamada-diaria", expect.objectContaining({ start: "2026-10-01", end: "2026-10-17" }));
    expect(Object.keys(await import("./route"))).toEqual(["GET"]);
  });
  it.each([401, 403])("repassa negativa de acesso%i sem consultar fonte", async (status) => {
    mocks.session.mockResolvedValue({ response: Response.json({ error: "Acesso negado" }, { status }) });
    expect((await GET(request(), params())).status).toBe(status);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("rejeita domínio, período e parâmetros extras", async () => {
    expect((await GET(request(), params("unknown"))).status).toBe(404);
    expect((await GET(request("start=2026-10-01&end=2026-11-01"), params())).status).toBe(400);
    expect((await GET(request("start=2026-10-01&end=2026-10-17&userId=another-user"), params())).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("retornaJSONprivadoeCSVda mesmafonte autenticada", async () => {
    const json = await GET(request(), params());
    expect(json.headers.get("Cache-Control")).toContain("no-store");
    const csv = await GET(request("start=2026-10-01&end=2026-10-17&format=csv"), params());
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
    expect(csv.headers.get("Content-Disposition")).toContain("dashboard-chamada-diaria.csv");
    expect(await csv.text()).toContain("Chamada");
  });
  it.each([[409, "DASHBOARD_SOURCE_CHANGED"], [422, "DASHBOARD_TOO_LARGE"]])("retorna%iquandoorecortenãopodeseragregado", async (status, code) => {
    mocks.load.mockRejectedValue(new DashboardError(code as string, status as number));
    expect((await GET(request(), params())).status).toBe(status);
  });
  it("falha503semfallback de fixtures ou detalhes internos", async () => {
    mocks.load.mockRejectedValue(new Error("secret internal failure"));
    const response = await GET(request(), params());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret internal failure");
  });
});
