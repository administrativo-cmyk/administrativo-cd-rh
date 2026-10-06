import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), single: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: mocks.getClaims },
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }),
    rpc: mocks.rpc,
  }),
}));

import { PUT } from "./route";

const employeeId = "30000000-0000-0000-0000-000000000001";
const input = { employeeId, date: "2026-10-06", status: "P", observation: "  texto  ", expectedUpdatedAt: null };
const request = (body: unknown = input, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/daily-call/entry", {
  method: "PUT", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
});

describe("gravação ADMIN da Chamada Diária", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.clearAllMocks();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "fictitious-user" } }, error: null });
    mocks.single.mockResolvedValue({ data: { status_usuario: "APROVADO", papel_usuario: "ADMIN" } });
    mocks.rpc.mockResolvedValue({ data: { changed: true, record: { date: input.date, status: "P", observation: "texto", updatedAt: "2026-10-06T12:00:00Z" } }, error: null });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("passes both trusted local origins to the session check without a database write", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("sem sessao") });
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      expect((await PUT(request(input, origin))).status).toBe(401);
    }
    expect(mocks.getClaims).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("blocks missing or malicious Origin before session and RPC checks", async () => {
    const missingOrigin = new Request("http://localhost:3000/api/daily-call/entry", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    expect((await PUT(missingOrigin)).status).toBe(403);
    expect((await PUT(request(input, "http://localhost.evil.example"))).status).toBe(403);
    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejeita origem externa e payload inválido antes da RPC", async () => {
    expect((await PUT(request(input, "https://outro.exemplo"))).status).toBe(403);
    expect((await PUT(request({ ...input, status: "ZZ" }))).status).toBe(400);
    expect((await PUT(request({ ...input, status: null, observation: "sem status" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejeita usuário sem sessão", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("sem sessão") });
    expect((await PUT(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["PENDENTE", "ADMIN"], ["BLOQUEADO", "ADMIN"], ["APROVADO", "RH"],
    ["APROVADO", "GESTOR"], ["APROVADO", "LEITURA"],
  ])("rejeita %s/%s", async (status_usuario, papel_usuario) => {
    mocks.single.mockResolvedValue({ data: { status_usuario, papel_usuario } });
    expect((await PUT(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("usa somente identidade da sessão, aplica trim e não aceita ator do client", async () => {
    const response = await PUT(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("salvar_chamada_diaria", {
      p_colaborador_id: employeeId, p_data: input.date, p_status: "P", p_observacao: "texto", p_expected_updated_at: null,
    });
    expect(await response.json()).toMatchObject({ changed: true, record: { status: "P" } });
    expect((await PUT(request({ ...input, alteredBy: "forged" }))).status).toBe(400);
  });

  it("converte conflito de versão em 409, sem sucesso falso", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PT409" } });
    const response = await PUT(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("alterado por outro usuário");
  });

  it("não divulga detalhes internos de erro do banco", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret" } });
    const response = await PUT(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
