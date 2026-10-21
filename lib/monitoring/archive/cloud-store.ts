import { archivePath, archiveObjectLimit, archiveStorageBudget, digest, unpackObject, type ArchiveObject } from "./format.ts";
export const historyBucket = "monitoramento-historico";
export type StoredArchiveObject = ArchiveObject & { kind: "snapshot" | "manifest" | "original" | "archive_rows" | "nsr_index"; metadata: Record<string, unknown> };

/** Server/maintenance use only. The secret is never included in errors, receipts or returned data. */
export class ArchiveCloudStore {
  private readonly origin: URL;
  private usedBytes: number | null = null;
  private budget: Promise<void> | null = null;
  readonly projectRef: string;
  private readonly key: string;
  constructor(projectRef: string, key: string, url: string) {
    this.projectRef = projectRef; this.key = key;
    this.origin = new URL(url);
    if (!/^[a-z]{20}$/.test(projectRef) || !key || this.origin.protocol !== "https:" || this.origin.hostname !== `${projectRef}.supabase.co`
      || this.origin.pathname !== "/" || this.origin.username || this.origin.password || this.origin.search || this.origin.hash) throw new Error("ARCHIVE_PROJECT_MISMATCH");
  }
  private headers() { return { apikey: this.key, Authorization: `Bearer ${this.key}` }; }
  private url(path: string) { return new URL(path, this.origin); }
  private async request(url: URL, init: RequestInit, retries = false) {
    for (let attempt=0; ;attempt++) {
      try { return await fetch(url,{...init,signal:AbortSignal.timeout(init.method==="POST"?120000:60000)}); }
      catch { if(!retries||attempt>=2)throw new Error("ARCHIVE_NETWORK_ERROR");await new Promise(resolve=>setTimeout(resolve,500*(attempt+1))); }
    }
  }
  async rpc<T = Record<string, unknown>>(action: string, data: unknown = {}): Promise<T> {
    const response = await this.request(this.url("/rest/v1/rpc/monitoring_archive_worker"), {
      method: "POST", headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ p_action: action, p_data: data }), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(120_000),
    },["state","policy","catalog","page","indices","file","objects","exported","export_status","register_file","register_index","begin","seal"].includes(action));
    const value = await response.json();
    if (!response.ok) {
      const code = typeof value.message === "string" ? value.message.match(/\bARCHIVE_[A-Z_]+\b/)?.[0] : null;
      throw new Error(code ?? "ARCHIVE_RPC_FAILED");
    }
    return value as T;
  }
  async download(object: Pick<ArchiveObject, "path" | "sha256" | "bytes">): Promise<Buffer> {
    for(let attempt=0;;attempt++){
      try{return await this.downloadOnce(object);}
      catch(error){
        if(error instanceof Error&&["ARCHIVE_PATH_INVALID","ARCHIVE_OBJECT_LIMIT","ARCHIVE_REMOTE_HASH_MISMATCH"].includes(error.message))throw error;
        if(attempt>=3)throw new Error("ARCHIVE_DOWNLOAD_FAILED");
        await new Promise(resolve=>setTimeout(resolve,500*2**attempt));
      }
    }
  }
  private async downloadOnce(object: Pick<ArchiveObject, "path" | "sha256" | "bytes">): Promise<Buffer> {
    archivePath(object.path);
    const pathname = object.path.split("/").map(encodeURIComponent).join("/");
    const response = await this.request(this.url(`/storage/v1/object/authenticated/${historyBucket}/${pathname}`), {
      headers: this.headers(), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(60_000),
    },true);
    if (!response.ok || !response.body) throw new Error("ARCHIVE_DOWNLOAD_FAILED");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > archiveObjectLimit || size > object.bytes) throw new Error("ARCHIVE_OBJECT_LIMIT"); chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => undefined); throw error; } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks, size);
    if (bytes.length !== object.bytes) throw new Error("ARCHIVE_DOWNLOAD_INCOMPLETE");
    if (digest(bytes) !== object.sha256) throw new Error("ARCHIVE_REMOTE_HASH_MISMATCH");
    return bytes;
  }
  async put(object: StoredArchiveObject, compressed: Buffer) {
    // Verify both compressed and original bytes before publishing anything.
    unpackObject(object, compressed);
    this.budget ??= this.rpc<{ storageBytes: number }>("state").then(state => { this.usedBytes = Number(state.storageBytes); });
    await this.budget;
    if (this.usedBytes === null || !Number.isFinite(this.usedBytes) || this.usedBytes + compressed.length > archiveStorageBudget) throw new Error("ARCHIVE_STORAGE_BUDGET_EXCEEDED");
    this.usedBytes += compressed.length;
    const pathname = object.path.split("/").map(encodeURIComponent).join("/");
    const response = await this.request(this.url(`/storage/v1/object/${historyBucket}/${pathname}`), {
      method: "POST", headers: { ...this.headers(), "Content-Type": "application/gzip", "x-upsert": "false" },
      body: new Uint8Array(compressed), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(120_000),
    },true);
    if (!response.ok && ![400, 409].includes(response.status)) throw new Error("ARCHIVE_UPLOAD_FAILED");
    await response.body?.cancel().catch(() => undefined);
    // A retry may find the immutable object. Never overwrite it: reread and compare its bytes.
    const verified = await this.download(object);
    if (!verified.equals(compressed)) throw new Error("ARCHIVE_REMOTE_HASH_MISMATCH");
    await this.rpc("objects", { objects: [object] });
    if (!response.ok) this.usedBytes -= compressed.length;
    return object;
  }
}
