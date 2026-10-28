import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), single: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: mocks.getClaims }, from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }), rpc: mocks.rpc }) }));
import { GET } from "./route";
const request = () => new Request("http://localhost:3000/api/monitoring/identity-photo?sourceId=defense-test&identityValue=000123");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "10000000-0000-4000-8000-000000000001" } } });
  mocks.single.mockResolvedValue({ data: { status_usuario: "APROVADO", papel_usuario: "ADMIN" } });
  mocks.rpc.mockResolvedValue({ data: { mimeType: "image/jpeg", base64: "YWJj", sha256: "a".repeat(64) }, error: null });
});
describe("prévia restrita de foto Defense", () => {
  it("recusa sessão ausente antes da RPC", async () => {
    mocks.getClaims.mockResolvedValue({ data: null });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["GESTOR", "LEITURA"])("recusa perfil %s antes da RPC", async (role) => {
    mocks.single.mockResolvedValue({ data: { status_usuario: "APROVADO", papel_usuario: role } });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["PENDENTE", "BLOQUEADO"])("recusa ADMIN %s", async (status) => {
    mocks.single.mockResolvedValue({ data: { status_usuario: status, papel_usuario: "ADMIN" } });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["ADMIN", "RH"])("entrega somente a imagem a %s, sem cache público", async (role) => {
    mocks.single.mockResolvedValue({ data: { status_usuario: "APROVADO", papel_usuario: role } });
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-cache");
    expect(result.headers.get("content-type")).toBe("image/jpeg");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await result.text()).toBe("abc");
    expect(mocks.rpc).toHaveBeenCalledWith("monitoring_identity_photo", { p_source_id: "defense-test", p_identity_value: "000123", p_variant: "full" });
  });
  it("foto inexistente retorna 404 privado", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const result = await GET(request());
    expect(result.status).toBe(404);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  });
  it("solicita miniatura na lista e resolução completa no zoom", async () => {
    const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#00aabb" } }).png().toBuffer();
    mocks.rpc.mockResolvedValue({ data: { mimeType: "image/png", base64: bytes.toString("base64"), sha256: "a".repeat(64) }, error: null });
    const thumbnail = await GET(new Request(`${request().url}&size=avatar`));
    expect(thumbnail.status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("monitoring_identity_photo", { p_source_id: "defense-test", p_identity_value: "000123" });
    const full = await GET(request());
    expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
    expect(full.headers.get("content-type")).toBe("image/png");
    expect(mocks.rpc).toHaveBeenLastCalledWith("monitoring_identity_photo", { p_source_id: "defense-test", p_identity_value: "000123", p_variant: "full" });
  });
  it("recusa parâmetros vazios sem RPC", async () => {
    expect((await GET(new Request("http://localhost:3000/api/monitoring/identity-photo?sourceId=defense-test"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
