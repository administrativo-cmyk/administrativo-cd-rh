import "server-only";
import { cloudBucket, cloudMaxFileBytes, cloudObjectPath, CloudError, type CloudJob } from "./server";

/** Stream the private object from the configured project, with a real byte limit and no redirects. */
export async function downloadCloudObject(job: CloudJob, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.MONITORING_SUPABASE_SERVICE_ROLE_KEY;
  if (!configured || !key) throw new CloudError("CLOUD_UNAVAILABLE");
  const origin = new URL(configured);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new CloudError("CLOUD_UNAVAILABLE");
  const objectPath = cloudObjectPath(job).split("/").map(encodeURIComponent).join("/");
  const url = new URL(`/storage/v1/object/authenticated/${cloudBucket}/${objectPath}`, origin);
  const response = await fetch(url, {
    method: "GET", headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Encoding": "identity" },
    redirect: "error", cache: "no-store", signal,
  });
  if (!response.ok || !response.body) throw new CloudError("CLOUD_DOWNLOAD_FAILED");
  const contentLength = response.headers.get("content-length");
  // Fetch decodes gzip/br responses, while Content-Length describes their compressed wire size.
  // The streamed, decoded bytes below remain authoritative even if a proxy ignores identity.
  const encoded = !["", "identity"].includes(response.headers.get("content-encoding")?.trim().toLowerCase() ?? "");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || (!encoded && (Number(contentLength) !== job.byteLength || Number(contentLength) > cloudMaxFileBytes)))) {
    await response.body.cancel(); throw new CloudError("CLOUD_SIZE_MISMATCH");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let count = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read(); if (done) break;
      count += value.byteLength;
      if (count > job.byteLength || count > cloudMaxFileBytes) throw new CloudError("CLOUD_SIZE_MISMATCH");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  if (count !== job.byteLength) throw new CloudError("CLOUD_SIZE_MISMATCH");
  return Buffer.concat(chunks, count);
}
