import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/monitoring/server", () => ({ monitoringSession: mocks.session, boundedJson: (request: Request) => request.json() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { GET, POST } from "./route";
const employeeId = "30000000-0000-4000-8000-000000000001";
const period = { employeeId, start: "2026-10-02", end: "2026-10-02" };
const url = `https://app.example/api/monitoring/attendance-history?${new URLSearchParams(period)}`;
const correction = { ...period, date: period.start, reason: "Conferência sintética pelo RH", expectedUpdatedAt: null, punches: ["08:00", "12:00", "13:00", "17:00"].map(time => ({ at: `${period.start}T${time}:00-03:00` })) };
const post = (data = correction, origin = "https://app.example") => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(data) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("APP_ORIGIN", "https://app.example");
  mocks.session.mockResolvedValue({ userId: employeeId, profile: { papel_usuario: "RH" } });
  mocks.rpc.mockResolvedValue({ data: { input: { version: 1, sources: [], events: [], settings: [] }, bank: null, canEdit: true, correctionHistory: [] }, error: null });
});
describe("authenticated employee punch history", () => {
  it("returns calculated days without exposing the raw database input", async () => {
    const response = await GET(new Request(url)); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.days).toHaveLength(1); expect(body.days[0].bankDay.deltaMinutes).toBeNull();
    expect(body).not.toHaveProperty("input"); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc.mock.calls[0][1].p_data).toEqual(period);
  });
  it("rejects missing session, invalid periods and foreign origin before invoking the database", async () => {
    expect((await POST(post(correction, "https://foreign.example"))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await GET(new Request(url.replace("end=2026-10-02", "end=2026-12-31")))).status).toBe(400);
    mocks.session.mockResolvedValue({ response: Response.json({ error: "Sessão necessária" }, { status: 401 }) });
    expect((await GET(new Request(url))).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires ADMIN/RH correction permission on the server", async () => {
    mocks.session.mockResolvedValue({ response: Response.json({ error: "Acesso não autorizado" }, { status: 403 }) });
    expect((await POST(post())).status).toBe(403); expect(mocks.session).toHaveBeenCalledWith(true); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("saves four explicitly confirmed marks and reports concurrent corrections", async () => {
    mocks.rpc.mockResolvedValue({ data: { changed: true }, error: null });
    expect((await POST(post())).status).toBe(200); expect(mocks.rpc.mock.calls[0][1].p_action).toBe("correct");
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PT409", message: "ATTENDANCE_STALE private details" } });
    const response = await POST(post()); expect(response.status).toBe(409); expect(JSON.stringify(await response.json())).not.toContain("private details");
  });
});
