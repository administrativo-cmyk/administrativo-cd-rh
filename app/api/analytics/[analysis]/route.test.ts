import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), load: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/dashboards/server", () => ({ dashboardSession: mocks.session }));
vi.mock("@/lib/analytics/server", () => ({ loadAnalysis: mocks.load }));
vi.mock("@/lib/security/operational-error", () => ({ reportOperationalError: mocks.report }));
import { GET } from "./route";
const context = (analysis = "top-20-banco-horas") => ({ params: Promise.resolve({ analysis }) });
const request = (query = "end=2026-10-17") => new Request(`http://localhost:3000/api/analytics/top-20-banco-horas?${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: "real-session", role: "GESTOR" });
  mocks.report.mockReturnValue("correlation");
  mocks.load.mockResolvedValue({ domain: "top-20-banco-horas", title: "Top 20", start: "2026-10-17", end: "2026-10-17", queriedAt: "2026-10-17T15:00:00Z", notes: [], metrics: [], table: { columns: [], rows: [] } });
});
describe("API de análises somenteleitura", () => {
  it("aguarda params e só exporta GET", async () => {
    expect((await GET(request(), context())).status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith("top-20-banco-horas", expect.objectContaining({ end: "2026-10-17", start: "2026-10-17" }));
    expect(Object.keys(await import("./route"))).toEqual(["GET"]);
  });
  it.each([401, 403])("nega%i antes de consultar fonte", async (status) => {
    mocks.session.mockResolvedValue({ response: Response.json({ error: "Acesso negado" }, { status }) });
    expect((await GET(request(), context())).status).toBe(status);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("rejeita análise inválida, data inválida e seleção de usuário", async () => {
    expect((await GET(request(), context("unknown"))).status).toBe(404);
    expect((await GET(request("end=2026-02-30"), context())).status).toBe(400);
    expect((await GET(request("userId=someone"), context())).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("JSONeCSV são privados e reutilizam fonte autenticada", async () => {
    expect((await GET(request(), context())).headers.get("Cache-Control")).toContain("no-store");
    const response = await GET(request("end=2026-10-17&format=csv"), context());
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain("analise-top-20-banco-horas.csv");
    expect(await response.text()).toContain("Top 20");
  });
  it("erro interno retorna503 sem detalhes ou dados fictícios", async () => {
    mocks.load.mockRejectedValue(new Error("secret internal"));
    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret internal");
  });
});
