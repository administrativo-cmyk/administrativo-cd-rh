import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), single: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: mocks.getClaims }, from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }), rpc: mocks.rpc }) }));
import { POST } from "./route";
const request = (data: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/administration", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(data) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "10000000-0000-4000-8000-000000000001" } } });
  mocks.single.mockResolvedValue({ data: { status_usuario: "APROVADO", papel_usuario: "ADMIN" } });
  mocks.rpc.mockResolvedValue({ data: { changed: true }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("API administrativa", () => {
  it("recusa origem externa antes de ler sessão ou gravar", async () => {
    expect((await POST(request({ entity: "unit", action: "list", data: {} }, "https://other.example"))).status).toBe(403);
    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("recusa ausência de sessão", async () => {
    mocks.getClaims.mockResolvedValue({ data: null });
    expect((await POST(request({ entity: "unit", action: "list" }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["PENDENTE", "BLOQUEADO"])("recusa perfil %s", async status => {
    mocks.single.mockResolvedValue({ data: { status_usuario: status, papel_usuario: "ADMIN" } });
    expect((await POST(request({ entity: "unit", action: "list" }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("atualização exige versão antes da RPC", async () => {
    expect((await POST(request({ entity: "unit", action: "save", data: { id: "20000000-0000-4000-8000-000000000001", code: "CD TEST", name: "Teste", reason: "Correção teste" } }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserva matrícula com zeros e usa o wrapper autenticado", async () => {
    const response = await POST(request({ entity: "employee", action: "save", data: { employeeNumber: "0000123", name: "Pessoa teste", unitId: "20000000-0000-4000-8000-000000000001", situation: "ATIVO", workdayHours: 8, reason: "Cadastro teste" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("administration", expect.objectContaining({ p_entity: "employee", p_action: "save", p_data: expect.objectContaining({ employeeNumber: "0000123", managerId: null }) }));
  });
  it.each([
    { startDate: "2027-02-30", endDate: "2027-03-03" },
    { startDate: "2027-03-03", endDate: "2027-02-28" },
    { startDate: "2027-03-03", endDate: "2027-03-20", acquisitionStart: "2026-01-01" },
  ])("recusa período inválido %j sem gravação", async dates => {
    expect((await POST(request({ entity: "vacation", action: "save", data: { employeeId: "20000000-0000-4000-8000-000000000001", status: "draft", reason: "Planejamento teste", ...dates } }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("não aceita campos privados no cadastro", async () => {
    expect((await POST(request({ entity: "unit", action: "save", data: { code: "TEST", name: "Teste", reason: "Cadastro teste", createdBy: "spoofed" } }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("retorna conflito de versão sem expor detalhes do banco", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "ADMINISTRATION_STALE internal secret detail" } });
    const response = await POST(request({ entity: "unit", action: "save", data: { code: "TEST", name: "Teste", reason: "Cadastro teste" } }));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("secret");
  });
});
