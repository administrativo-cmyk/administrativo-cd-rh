import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), capability: vi.fn(), thumbnail: vi.fn(), original: vi.fn(), put: vi.fn(), putOriginal: vi.fn() }));
vi.mock("@/lib/monitoring/server", async (original) => ({ ...await original<typeof import("@/lib/monitoring/server")>(), workerClient: () => ({ rpc: (name: string, args: unknown) => name === "monitoring_photo_storage" ? mocks.capability(name,args) : mocks.rpc(name,args) }) }));
vi.mock("@/lib/monitoring/photo-thumbnail", async (original) => ({ ...await original<typeof import("@/lib/monitoring/photo-thumbnail")>(), createPhotoThumbnail: mocks.thumbnail, createPhotoPreview: mocks.thumbnail, readOriginalPhoto: mocks.original }));
vi.mock("@/lib/monitoring/photo-storage-server", () => ({ serverPhotoStorage: () => ({ put: mocks.put, putOriginal: mocks.putOriginal }) }));
import { InvalidPhotoError } from "@/lib/monitoring/photo-thumbnail";
import { GET, POST } from "./route";
const token = "synthetic-worker-token-for-unit-test-only";
const source = Buffer.from("synthetic-input");
const thumbnail = Buffer.from("synthetic-output");
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const storedPreview = { sha256: hash(thumbnail), mimeType: "image/jpeg", storagePath: `previews/${hash(thumbnail)}.jpg`, byteLength: thumbnail.length };
const input = { sourceId: "fixture-person", identityValue: "000001", sha256: hash(source), mimeType: "image/png", base64: source.toString("base64") };
const request = (body: unknown = input, authorization: string | null = `Bearer ${token}`) => new Request("http://localhost:3000/api/monitoring/ingest/photo", { method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MONITORING_INGEST_TOKEN", token); vi.stubEnv("MONITORING_INGEST_SOURCE_IDS", input.sourceId);
  mocks.capability.mockResolvedValue({data:{photoStorage:true},error:null});
  mocks.thumbnail.mockResolvedValue(thumbnail); mocks.put.mockResolvedValue(storedPreview); mocks.rpc.mockResolvedValue({ data: { accepted: true, previewStored: true, previewStorage: true }, error: null });
  mocks.original.mockResolvedValue({bytes:source,mimeType:input.mimeType});
});
afterEach(() => vi.unstubAllEnvs());
describe("ingestão protegida de fotos", () => {
  it("mantém ingestão compatível antes da migration, sem esconder indisponibilidade do banco", async () => {
    mocks.capability.mockResolvedValue({data:null,error:{code:"PGRST202"}});
    expect((await POST(request())).status).toBe(200);
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls[0][1].p_data.photoWithPreview.preview.base64).toBe(thumbnail.toString("base64"));
    mocks.rpc.mockClear();mocks.capability.mockResolvedValue({data:null,error:{code:"08006"}});
    expect((await POST(request())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("não grava referência no banco quando a cópia privada não foi conferida", async () => {
    mocks.put.mockRejectedValue(new Error("PHOTO_STORAGE_HASH_MISMATCH"));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("anuncia insertOnly por consulta autenticada sem executar gravação", async () => {
    expect((await GET(request(input, null))).status).toBe(401);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ insertOnly: true, photoPreview: true, photoStorage: true, photoOriginal: true, protocolVersion: 1 });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.thumbnail).not.toHaveBeenCalled();
  });
  it("recusa credencial, fonte ou hash inválidos antes de decodificar/gravar", async () => {
    expect((await POST(request(input, null))).status).toBe(401);
    expect((await POST(request({ ...input, sourceId: "other-source" }))).status).toBe(403);
    expect((await POST(request({ ...input, sha256: "0".repeat(64) }))).status).toBe(400);
    expect(mocks.thumbnail).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("persiste foto normalizada para ampliação com hash próprio e identidade intacta", async () => {
    const result = await POST(request());
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ accepted: true });
    expect(mocks.thumbnail).toHaveBeenCalledWith(source);
    expect(mocks.rpc).toHaveBeenCalledWith("monitoring_ingest", { p_data: { photoWithStoredPreview: { thumbnail: { ...input, sha256: hash(thumbnail), mimeType: "image/jpeg", base64: thumbnail.toString("base64") }, preview: storedPreview, insertOnly: false } } });
  });
  it("grava o original sem recompressão quando o banco suporta seu formato", async () => {
    const original = { ...storedPreview, mimeType: input.mimeType, sha256: hash(source), storagePath: `originals/${hash(source)}.png`, byteLength: source.length };
    mocks.capability.mockResolvedValue({data:{photoStorage:true,photoOriginal:true},error:null});
    mocks.putOriginal.mockResolvedValue(original);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.putOriginal).toHaveBeenCalledWith(source,"image/png");
    expect(mocks.rpc.mock.calls[0][1].p_data.photoWithStoredPreview).toMatchObject({preview:original,thumbnail:{sha256:hash(thumbnail)}});
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
    mocks.rpc.mockResolvedValue({ data: { ok: true, insertOnly: true, status, sha256: hash(thumbnail), previewStored: true, previewStorage: true }, error: null });
    const response = await POST(request({ ...input, insertOnly: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, insertOnly: true, status, sha256: hash(thumbnail) });
    expect(mocks.rpc).toHaveBeenCalledWith("monitoring_ingest", { p_data: { photoWithStoredPreview: { thumbnail: { ...input, insertOnly: true, sha256: hash(thumbnail), mimeType: "image/jpeg", base64: thumbnail.toString("base64") }, preview: storedPreview, insertOnly: true } } });
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
    expect(mocks.rpc.mock.calls[0][1].p_data.photoWithStoredPreview.insertOnly).toBe(false);
  });
});
