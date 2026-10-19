import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), thumbnail: vi.fn() }));
vi.mock("@/lib/monitoring/server", async (original) => ({ ...await original<typeof import("@/lib/monitoring/server")>(), workerClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/monitoring/photo-thumbnail", async (original) => ({ ...await original<typeof import("@/lib/monitoring/photo-thumbnail")>(), createPhotoThumbnail: mocks.thumbnail }));
import { InvalidPhotoError } from "@/lib/monitoring/photo-thumbnail";
import { GET, POST } from "./route";
const token = "synthetic-worker-token-for-unit-test-only";
const source = Buffer.from("synthetic-input");
const thumbnail = Buffer.from("synthetic-output");
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const input = { sourceId: "fixture-person", identityValue: "000001", sha256: hash(source), mimeType: "image/png", base64: source.toString("base64") };
const request = (body: unknown = input, authorization: string | null = `Bearer ${token}`) => new Request("http://localhost:3000/api/monitoring/ingest/photo", { method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MONITORING_INGEST_TOKEN", token); vi.stubEnv("MONITORING_INGEST_SOURCE_IDS", input.sourceId);
  mocks.thumbnail.mockResolvedValue(thumbnail); mocks.rpc.mockResolvedValue({ data: { accepted: true }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("ingestão protegida de fotos", () => {
  it("anuncia insertOnly por consulta autenticada sem executar gravação", async () => {
    expect((await GET(request(input, null))).status).toBe(401);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ insertOnly: true, protocolVersion: 1 });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.thumbnail).not.toHaveBeenCalled();
  });
  it("recusa credencial, fonte ou hash inválidos antes de decodificar/gravar", async () => {
    expect((await POST(request(input, null))).status).toBe(401);
    expect((await POST(request({ ...input, sourceId: "other-source" }))).status).toBe(403);
    expect((await POST(request({ ...input, sha256: "0".repeat(64) }))).status).toBe(400);
    expect(mocks.thumbnail).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("persiste somente miniatura normalizada com hash próprio e identidade intacta", async () => {
    const result = await POST(request());
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ accepted: true });
    expect(mocks.thumbnail).toHaveBeenCalledWith(source);
    expect(mocks.rpc).toHaveBeenCalledWith("monitoring_ingest", { p_data: { photo: { ...input, sha256: hash(thumbnail), mimeType: "image/jpeg", base64: thumbnail.toString("base64") } } });
  });
  it("foto inválida retorna400 sem RPC; falha operacional mantém503 com correlação sanitizada", async () => {
    mocks.thumbnail.mockRejectedValue(new InvalidPhotoError());
    expect((await POST(request())).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.thumbnail.mockRejectedValue(Object.assign(new Error("private details"), { code: "MODULE_NOT_FOUND" }));
    const result = await POST(request()); const body = await result.json();
    expect(result.status).toBe(503); expect(body.correlationId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("private details");
  });
  it.each(["inserted", "replayed"])("confirma %s apenas com envelope exclusivo e hash retornado pelo banco", async status => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, insertOnly: true, status, sha256: hash(thumbnail) }, error: null });
    const response = await POST(request({ ...input, insertOnly: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, insertOnly: true, status, sha256: hash(thumbnail) });
    expect(mocks.rpc).toHaveBeenCalledWith("monitoring_ingest", { p_data: { photoInsertOnly: { ...input, insertOnly: true, sha256: hash(thumbnail), mimeType: "image/jpeg", base64: thumbnail.toString("base64") } } });
  });
  it("retorna409 em conflito sem anunciar sucesso ou vazar dados da imagem existente", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "PHOTO_ALREADY_EXISTS", details: "private-existing-image" } });
    const response = await POST(request({ ...input, insertOnly: true }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Já existe outra foto para esta identidade.", code: "PHOTO_ALREADY_EXISTS", insertOnly: true });
  });
  it.each([
    null,
    { ok: true },
    { ok: true, insertOnly: true, status: "updated", sha256: hash(thumbnail) },
    { ok: true, insertOnly: true, status: "inserted", sha256: "0".repeat(64) },
  ])("não confirma uma resposta sem garantia de insertOnly: %j", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const response = await POST(request({ ...input, insertOnly: true }));
    expect(response.status).toBe(503);
    expect((await response.json()).accepted).not.toBe(true);
  });
  it("rejeita insertOnly de tipo inválido antes da gravação e mantém false compatível", async () => {
    expect((await POST(request({ ...input, insertOnly: "true" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await POST(request({ ...input, insertOnly: false }))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_data.photo.insertOnly).toBe(false);
  });
});
