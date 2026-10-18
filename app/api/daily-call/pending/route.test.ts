import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), single: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: mocks.getClaims }, from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }), rpc: mocks.rpc }) }));
import { GET, POST } from "./route";

const date = "2026-10-01";
const managerId = "20000000-0000-4000-8000-000000000001";
const snapshot = { start: date, end: date, revision: "one", rows: [], days: [], counts: { total: 0, present: 0, automaticAbsence: 0, manual: 0, pending: 0, blocked: 0 } };
const input = { action: "close", data: { date, managerId, expectedRevision: "one", reason: "Conferência sintética" } };
const post = (body: unknown = input, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/daily-call/pending", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
const get = (extra = "") => new Request(`http://localhost:3000/api/daily-call/pending?start=${date}&end=${date}${extra}`);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.clearAllMocks();
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "authenticated-user" } }, error: null });
  mocks.single.mockResolvedValue({ data: { status_usuario: "APROVADO", papel_usuario: "GESTOR" } });
  mocks.rpc.mockResolvedValue({ data: snapshot, error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("API de revisão da chamada", () => {
  it("exige sessão e aprovação", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("sem sessão") });
    expect((await GET(get())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user" } }, error: null });
    mocks.single.mockResolvedValue({ data: { status_usuario: "PENDENTE", papel_usuario: "GESTOR" } });
    expect((await GET(get())).status).toBe(403);
  });
  it("valida período e não aceita identidade de ator enviada pelo cliente", async () => {
    expect((await GET(new Request("http://localhost:3000/api/daily-call/pending?start=infinity&end=infinity"))).status).toBe(400);
    expect((await POST(post({ ...input, data: { ...input.data, actor: "forged" } }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("distingue todos os gestores de sem gestor e delega escopo à RPC autenticada", async () => {
    const result = await GET(get("&managerId=none"));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("daily_call_workflow", { p_action: "queue", p_data: { start: date, end: date, managerId: null, offset: 0, limit: 50 } });
    await GET(get());
    expect(mocks.rpc).toHaveBeenLastCalledWith("daily_call_workflow", { p_action: "queue", p_data: { start: date, end: date, offset: 0, limit: 50 } });
  });
  it("bloqueia origem externa e LEITURA antes de qualquer gravação", async () => {
    expect((await POST(post(input, "https://externo.example"))).status).toBe(403);
    expect(mocks.getClaims).not.toHaveBeenCalled();
    mocks.single.mockResolvedValue({ data: { status_usuario: "APROVADO", papel_usuario: "LEITURA" } });
    expect((await POST(post())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("mantém versão da revisão, comunica conflito e não expõe mensagem interna", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PT409", message: "private employee information" } });
    const result = await POST(post());
    expect(result.status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledWith("daily_call_workflow", { p_action: "close", p_data: input.data });
    const body = await result.json();
    expect(body.correlationId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("private employee");
  });
  it("rejeita resposta incompleta da fila em vez de fabricar pendências zero", async () => {
    mocks.rpc.mockResolvedValue({ data: { rows: [] }, error: null });
    expect((await GET(get())).status).toBe(503);
  });
  it("recusa sucesso vazio de mutação e valida fechamento confirmado", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await POST(post())).status).toBe(503);
    mocks.rpc.mockResolvedValue({ data: { closed: true, date, managerId, closedAt: "2026-10-02T00:00:00Z", revision: "two" }, error: null });
    expect((await POST(post())).status).toBe(200);
  });
  it.each(["PGRST202", "42883"])("informa instalação pendente sem detalhes internos: %s", async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private_schema.secret_function" } });
    const result = await GET(get());
    expect(result.status).toBe(503);
    const body = await result.json();
    expect(body.error).toContain("ainda não está habilitada no banco deste ambiente");
    expect(JSON.stringify(body)).not.toContain("secret_function");
  });
});
