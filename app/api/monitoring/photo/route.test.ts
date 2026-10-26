import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { photoDigest } from "@/lib/monitoring/photo-storage";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/monitoring/server", () => ({ monitoringSession: mocks.session, monitoringQuery: mocks.query, monitoringFailure: () => new Response(null, { status: 503 }) }));
import { GET } from "./route";
const url = "http://localhost/api/monitoring/photo?employeeId=30000000-0000-4000-8000-000000000001";
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({}); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("resolução da foto autorizada", () => {
  it("entrega os mesmos bytes do arquivo privado apenas após autorizar a identidade", async () => {
    const bytes=Buffer.from("synthetic-original");const sha256=photoDigest(bytes);
    mocks.query.mockResolvedValue({mimeType:"image/jpeg",sha256,storagePath:`previews/${sha256}.jpg`,byteLength:bytes.length});
    const fetch=vi.fn().mockResolvedValue(new Response(bytes));vi.stubGlobal("fetch",fetch);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://aaaaaaaaaaaaaaaaaaaa.supabase.co");vi.stubEnv("MONITORING_SUPABASE_SERVICE_ROLE_KEY","synthetic-secret");
    const response=await GET(new Request(url));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    fetch.mockClear();mocks.query.mockRejectedValue(new Error("DENIED"));
    expect((await GET(new Request(url))).status).toBe(503);expect(fetch).not.toHaveBeenCalled();
  });
  it("entrega o original no zoom e miniatura leve na lista, sempre sem cache público", async () => {
    const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#00aabb" } }).png().toBuffer();
    mocks.query.mockResolvedValue({ mimeType: "image/png", base64: bytes.toString("base64"), sha256: "a".repeat(64) });
    const original = await GET(new Request(url));
    expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes);
    const thumbnail = await GET(new Request(`${url}&size=avatar`));
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.query).toHaveBeenCalledWith("photo", { employeeId: "30000000-0000-4000-8000-000000000001" });
    expect(mocks.query).toHaveBeenCalledWith("photo", { employeeId: "30000000-0000-4000-8000-000000000001", photoVariant: "full" });
  });
  it("recusa sessão ausente antes de ler ou transformar a foto", async () => {
    mocks.session.mockResolvedValue({ response: new Response(null, { status: 401 }) });
    expect((await GET(new Request(`${url}&size=avatar`))).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
