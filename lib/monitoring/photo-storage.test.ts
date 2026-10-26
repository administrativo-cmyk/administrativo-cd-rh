import { afterEach, describe, expect, it, vi } from "vitest";
import { PhotoStorage, photoDigest } from "./photo-storage";

const bytes = Buffer.from("synthetic-full-resolution-image");
const sha256 = photoDigest(bytes);
const image = { mimeType: "image/jpeg" as const, sha256, storagePath: `previews/${sha256}.jpg`, byteLength: bytes.length };
const store = () => new PhotoStorage("https://aaaaaaaaaaaaaaaaaaaa.supabase.co", "synthetic-secret");
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("private immutable photo storage", () => {
  it("reads private photos only from the explicitly configured self-hosted origin", async () => {
    vi.stubEnv("SUPABASE_SELF_HOSTED_ORIGIN", "https://supabase-rh.example.com");
    const fetch = vi.fn().mockResolvedValue(new Response(bytes)); vi.stubGlobal("fetch", fetch);
    const selfHosted = new PhotoStorage("https://supabase-rh.example.com", "synthetic-secret");
    expect(await selfHosted.download(image)).toEqual(bytes);
    expect(String(fetch.mock.calls[0][0])).toBe(`https://supabase-rh.example.com/storage/v1/object/authenticated/monitoramento-fotos/${image.storagePath}`);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { Authorization: "Bearer synthetic-secret" } });
  });
  it.each([200, 409])("rereads and verifies every upload, including status %s", async status => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status })).mockResolvedValueOnce(new Response(bytes));
    vi.stubGlobal("fetch", fetch);
    expect(await store().put(bytes)).toEqual(image);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].headers["x-upsert"]).toBe("false");
    expect(String(fetch.mock.calls[1][0])).toContain("/object/authenticated/monitoramento-fotos/previews/");
    expect(fetch.mock.calls[1][1]).toMatchObject({ redirect: "error", cache: "no-store" });
  });
  it("does not confirm mismatched or truncated objects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null)).mockResolvedValueOnce(new Response("other image")));
    await expect(store().put(bytes)).rejects.toThrow("PHOTO_STORAGE_HASH_MISMATCH");
  });
  it.each([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]] as const)("preserves the original %s with a verified immutable path", async (mimeType, extension) => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null)).mockResolvedValueOnce(new Response(bytes));
    vi.stubGlobal("fetch", fetch);
    expect(await store().putOriginal(bytes, mimeType)).toEqual({ ...image, mimeType, storagePath: `originals/${sha256}.${extension}` });
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { "Content-Type": mimeType, "x-upsert": "false" }, body: new Uint8Array(bytes) });
    await expect(store().download({ ...image, mimeType, storagePath: `originals/${sha256}.wrong` })).rejects.toThrow();
  });
  it("rejects a path outside the digest namespace without issuing a request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(store().download({ ...image, storagePath: "../another-person.jpg" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds download size even if the server omits Content-Length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.alloc(bytes.length + 1))));
    await expect(store().download(image)).rejects.toThrow("PHOTO_STORAGE_SIZE_MISMATCH");
  });
});
