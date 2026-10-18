import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), single: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: mocks.getClaims },
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }),
  }),
}));
vi.mock("@/lib/data/supabase-daily-call-repository", () => ({
  SupabaseDailyCallRepository: class { load = mocks.load; },
}));

import { GET } from "./route";

const request = () => new Request("http://localhost:3000/api/daily-call?date=2026-10-05&start=2026-10-01&end=2026-10-31");

describe("endpoint de leitura da Chamada Diária", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "fictitious-user" } }, error: null });
    mocks.single.mockResolvedValue({ data: { status_usuario: "APROVADO", papel_usuario: "ADMIN" } });
    mocks.load.mockResolvedValue({ date: "2026-10-05", startDate: "2026-10-01", endDate: "2026-10-31", employees: [] });
  });

  it("rejeita sessão ausente sem consultar colaboradores", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("sem sessão") });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it.each([
    ["PENDENTE", "ADMIN"], ["BLOQUEADO", "ADMIN"],
  ])("rejeita perfil %s/%s", async (status_usuario, papel_usuario) => {
    mocks.single.mockResolvedValue({ data: { status_usuario, papel_usuario } });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "RH", "GESTOR", "LEITURA"])("permite leitura ao papel aprovado %s", async (papel_usuario) => {
    mocks.single.mockResolvedValue({ data: { status_usuario: "APROVADO", papel_usuario } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ employees: [] });
    expect(Object.keys(await import("./route"))).toEqual(["GET"]);
  });

  it("falha explicitamente quando a consulta falha, sem retornar mocks", async () => {
    mocks.load.mockRejectedValue(new Error("banco indisponível"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Não foi possível carregar a Chamada Diária.", correlationId: expect.any(String) });
  });
});
