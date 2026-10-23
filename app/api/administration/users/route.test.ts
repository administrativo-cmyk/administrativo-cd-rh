import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), single: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: mocks.getClaims }, from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }), rpc: mocks.rpc }) }));
import { POST } from "./route";
import { POST as settingPOST } from "../../monitoring/config/route";
const request = (data: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/administration/users", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(data) });
const id = "10000000-0000-4000-8000-000000000001";
const edit = { id, expectedUpdatedAt: "2026-10-17T12:00:00Z", name: "Pessoa sintética", role: "LEITURA", managerId: null, reason: "Revisão sintética" };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "development");
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: id } } });
  mocks.single.mockResolvedValue({ data: { status_usuario: "APROVADO", papel_usuario: "ADMIN" } });
  mocks.rpc.mockResolvedValue({ data: { id, updatedAt: edit.expectedUpdatedAt }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("rejects foreign origin before session and RPC", async () => {
  expect((await POST(request({ action: "save", data: edit }, "https://foreign.example"))).status).toBe(403);
  expect(mocks.getClaims).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(["GESTOR", "LEITURA"])("rejects %s before user edit RPC", async role => {
  mocks.single.mockResolvedValue({ data: { status_usuario: "APROVADO", papel_usuario: role, visualizar_todos_gestores: role === "GESTOR" } });
  expect((await POST(request({ action: "save", data: edit }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([{ expectedUpdatedAt: undefined }, { role: "GESTOR", managerId: null }, { status_usuario: "APROVADO" }, { viewAllManagers: true }, { viewAllManagers: "true" }])("rejects incomplete or unauthorized fields %j", async extra => {
  expect((await POST(request({ action: "save", data: { ...edit, ...extra } }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("saves explicit manager visibility without changing role or team", async () => {
  const data = { ...edit, role: "GESTOR", managerId: id, viewAllManagers: true };
  expect((await POST(request({ action: "save", data }))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("administration_users", { p_action: "save", p_data: data });
});
it("uses session-only wrapper and private response caching", async () => {
  const response = await POST(request({ action: "save", data: edit }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.rpc).toHaveBeenCalledWith("administration_users", { p_action: "save", p_data: edit });
});
it("returns stale conflict without database detail", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "USER_EDIT_STALE private detail" } });
  const response = await POST(request({ action: "save", data: edit }));
  expect(response.status).toBe(409); expect(await response.text()).not.toContain("private detail");
});
it.each(["revoke_setting", "restore_setting", "replace_setting"])("requires CAS for %s", async action => {
  expect((await settingPOST(request({ action, data: { id, reason: edit.reason } }))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("restores through versioned setting wrapper", async () => {
  const data = { id, expectedUpdatedAt: edit.expectedUpdatedAt, reason: edit.reason };
  expect((await settingPOST(request({ action: "restore_setting", data }))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("monitoring_setting_change", { p_action: "restore", p_data: data });
});
