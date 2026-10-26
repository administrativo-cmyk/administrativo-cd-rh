import { createHash } from "node:crypto";
import { z } from "zod";
import { isTrustedSupabaseStorageOrigin } from "../supabase/storage-origin.ts";

export const photoBucket = "monitoramento-fotos";
export const photoByteLimit = 2_000_000;
export const storedPhotoSchema = z.object({
  mimeType: z.literal("image/jpeg"),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  storagePath: z.string().regex(/^previews\/[0-9a-f]{64}\.jpg$/),
  byteLength: z.number().int().positive().max(photoByteLimit),
}).refine(value => value.storagePath === `previews/${value.sha256}.jpg`);
export type StoredPhoto = z.infer<typeof storedPhotoSchema>;
export function photoDigest(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

/** Only server/maintenance callers receive credentials. Paths contain no employee identifiers. */
export class PhotoStorage {
  private readonly origin: URL;
  private readonly key: string;
  constructor(url: string, key: string) {
    this.key = key;
    this.origin = new URL(url);
    if (!key || !isTrustedSupabaseStorageOrigin(this.origin)) {
      throw new Error("PHOTO_STORAGE_CONFIGURATION");
    }
  }
  private headers() { return { apikey: this.key, Authorization: `Bearer ${this.key}` }; }
  async download(input: StoredPhoto): Promise<Buffer> {
    const photo = storedPhotoSchema.parse(input);
    const response = await fetch(new URL(`/storage/v1/object/authenticated/${photoBucket}/${photo.storagePath}`, this.origin), {
      headers: this.headers(), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("PHOTO_STORAGE_DOWNLOAD_FAILED"); }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > photo.byteLength) throw new Error("PHOTO_STORAGE_SIZE_MISMATCH");
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
    finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks, size);
    if (size !== photo.byteLength || photoDigest(bytes) !== photo.sha256) throw new Error("PHOTO_STORAGE_HASH_MISMATCH");
    return bytes;
  }
  async put(bytes: Buffer): Promise<StoredPhoto> {
    const sha256 = photoDigest(bytes);
    const photo = storedPhotoSchema.parse({ mimeType: "image/jpeg", sha256, storagePath: `previews/${sha256}.jpg`, byteLength: bytes.length });
    const response = await fetch(new URL(`/storage/v1/object/${photoBucket}/${photo.storagePath}`, this.origin), {
      method: "POST", headers: { ...this.headers(), "Content-Type": "image/jpeg", "x-upsert": "false" },
      body: new Uint8Array(bytes), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    await response.body?.cancel();
    if (!response.ok && ![400, 409].includes(response.status)) throw new Error("PHOTO_STORAGE_UPLOAD_FAILED");
    // Replays never replace an object. Even a successful upload must be reread before SQL can reference it.
    const verified = await this.download(photo);
    if (!verified.equals(bytes)) throw new Error("PHOTO_STORAGE_HASH_MISMATCH");
    return photo;
  }
}
