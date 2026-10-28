import "server-only";
import { z } from "zod";
import { PhotoStorage, storedPhotoSchema } from "./photo-storage";

const inlinePhoto = z.object({ mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), base64: z.string().max(2800000), sha256: z.string() });
const photoSchema = z.union([storedPhotoSchema, inlinePhoto]).nullable();
const noPhotoHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const photoHeaders = { "Cache-Control": "private, no-cache", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

export function serverPhotoStorage() {
  return new PhotoStorage(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.MONITORING_SUPABASE_SERVICE_ROLE_KEY ?? "");
}

/** Call only with the result of the employee-scoped or ADMIN/RH-authorized photo RPC. */
export async function authorizedPhotoResponse(value: unknown, request?: Request) {
  const photo = photoSchema.parse(value);
  if (!photo) return new Response(null, { status: 404, headers: noPhotoHeaders });
  const etag = JSON.stringify(photo.sha256);
  const headers = { ...photoHeaders, ETag: etag };
  // Authorization and the photo RPC run before reusing browser bytes.
  if (request?.headers.get("If-None-Match")?.split(",").some(tag => tag.trim().replace(/^W\//, "") === etag || tag.trim() === "*")) {
    return new Response(null, { status: 304, headers });
  }
  const bytes = "storagePath" in photo ? await serverPhotoStorage().download(photo) : Buffer.from(photo.base64, "base64");
  return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": photo.mimeType } });
}
