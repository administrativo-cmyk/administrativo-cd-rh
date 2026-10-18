import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/monitoring/server", () => ({ monitoringSession: mocks.session, boundedJson: (request: Request) => request.json() }));
vi.mock("@/lib/audit/server", () => ({ loadAuditHistory: mocks.load }));
import { POST } from "./route";
const request = (data: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/audit", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(data) });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "development"); mocks.session.mockResolvedValue({ userId: "synthetic-admin" }); mocks.load.mockResolvedValue({ rows: [], total: 0 }); });
describe("audit endpoint", () => {
 it("blocks untrusted origins before loading sensitive history", async () => { expect((await POST(request({}, "https://untrusted.example"))).status).toBe(403); expect(mocks.session).not.toHaveBeenCalled(); });
 it("requires administrative session and rejects invalid filters", async () => { expect((await POST(request({ from: "2026-02-30", to: "2026-03-01" }))).status).toBe(400); expect(mocks.session).toHaveBeenCalledWith(true); expect(mocks.load).not.toHaveBeenCalled(); });
 it("returns no-store and does not reveal database errors", async () => { mocks.load.mockRejectedValue(new Error("private schema details")); const response = await POST(request({ from: "2026-10-01", to: "2026-10-17" })); expect(response.status).toBe(503); expect(response.headers.get("Cache-Control")).toContain("no-store"); expect(await response.text()).not.toContain("private schema"); });
});
