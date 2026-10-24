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
  it("groups historical night punches using an authorized reference without backdating payroll", async () => {
    const dates = { employeeId, start: "2026-09-25", end: "2026-09-26" };
    const payload = { name: "APP 12x36", start: "19:00", end: "07:00", estimated: false, weeklyRosterConfirmed: true, cycle: { kind: "12x36", anchorDate: "2026-10-01" } };
    const input = { version: 1, settings: [], events: ["2026-09-25T18:56", "2026-09-25T20:23", "2026-09-25T21:23", "2026-09-26T07:01"].map((at, index) => ({
      id: `p-${index}`, sourceId: "clock", eligible: true, conflicted: false,
      payload: { key: `p-${index}`, type: "punch", timestamp: `${at}:00-03:00`, device: "clock", classification: "authorized", eligible: true, precisionSeconds: 1, identity: { type: "cpf", value: "synthetic" }, original: {} },
    })) };
    mocks.rpc.mockResolvedValueOnce({ data: { input, bank: null, canEdit: false, correctionHistory: [] }, error: null })
      .mockResolvedValueOnce({ data: { employeeId, version: "1", canEdit: false, setting: { id: employeeId, validFrom: "2026-09-29", validTo: null, updatedAt: "2026-10-19T12:00:00Z", payload } }, error: null });
    const response = await GET(new Request(`https://app.example/api/monitoring/attendance-history?${new URLSearchParams(dates)}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "employee_schedule", { p_action: "get", p_data: expect.objectContaining({ employeeId }) });
    expect(body.days[0].displayMarks).toHaveLength(4);
    expect(body.days[1].displayMarks).toEqual([]);
    expect(body.days.map((day: { bankDay: { punches: unknown[] } }) => day.bankDay.punches.length)).toEqual([3, 1]);
    expect(body.days.every((day: { bankDay: { deltaMinutes: number | null } }) => day.bankDay.deltaMinutes === null)).toBe(true);
    expect(body).not.toHaveProperty("input");
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
