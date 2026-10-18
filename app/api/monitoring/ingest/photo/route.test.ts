import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), thumbnail: vi.fn() }));
vi.mock("@/lib/monitoring/server", async (original) => ({ ...await original<typeof import("@/lib/monitoring/server")>(), workerClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/monitoring/photo-thumbnail", async (original) => ({ ...await original<typeof import("@/lib/monitoring/photo-thumbnail")>(), createPhotoThumbnail: mocks.thumbnail }));
import { InvalidPhotoError } from "@/lib/monitoring/photo-thumbnail";
import { POST } from "./route";
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
});
