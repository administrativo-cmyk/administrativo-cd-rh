import { afterEach, describe, expect, it, vi } from "vitest";
import { PhotoStorage, photoDigest } from "./photo-storage";

const bytes = Buffer.from("synthetic-full-resolution-image");
const sha256 = photoDigest(bytes);
const image = { mimeType: "image/jpeg" as const, sha256, storagePath: `previews/${sha256}.jpg`, byteLength: bytes.length };
const store = () => new PhotoStorage("https://aaaaaaaaaaaaaaaaaaaa.supabase.co", "synthetic-secret");
afterEach(() => vi.unstubAllGlobals());

describe("private immutable photo storage", () => {
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
