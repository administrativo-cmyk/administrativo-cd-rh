import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { PhotoStorage, photoDigest } from "../lib/monitoring/photo-storage.ts";
import { archiveStorageBudget } from "../lib/monitoring/archive/format.ts";
import { isTrustedSupabaseStorageOrigin } from "../lib/supabase/storage-origin.ts";

const args = process.argv.slice(2);
const argument = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
type State = { photos: number; pending: number; stored: number; pendingBytes: number; storageBytes: number; thumbnailProof: string; previewProof: string; databaseBytes: number; photoTableBytes: number };
type Photo = { sourceId: string; identityValue: string; thumbnailSha256: string; previewThumbnailSha256: string; sha256: string; base64: string };

async function run() {
  const project = argument("--project");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.MONITORING_SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!project || !isTrustedSupabaseStorageOrigin(new URL(url), project)) throw new Error("PHOTO_STORAGE_PROJECT_MISMATCH");
  const store = new PhotoStorage(url, key);
  async function rpc<T>(action: string, data: unknown = {}): Promise<T> {
    const response = await fetch(new URL("/rest/v1/rpc/monitoring_photo_storage", url), {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_action: action, p_data: data }), redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(typeof value.message === "string" ? value.message.match(/\bPHOTO_STORAGE_[A-Z_]+\b/)?.[0] ?? "PHOTO_STORAGE_RPC_FAILED" : "PHOTO_STORAGE_RPC_FAILED");
    return value as T;
  }
  const before = await rpc<State>("status");
  if (!args.includes("--apply")) { console.log(JSON.stringify({ mode: "read-only", ...before })); return; }
  // Removing inline bytes is allowed only after the deployed reader advertises Storage support.
  const app = new URL(argument("--app-url") ?? "");
  const token = process.env.MONITORING_INGEST_TOKEN;
  if (app.protocol !== "https:" || app.username || app.password || app.pathname !== "/" || app.search || app.hash || !token) throw new Error("PHOTO_STORAGE_APP_INVALID");
  const capability = await fetch(new URL("/api/monitoring/ingest/photo", app), {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!capability.ok || (await capability.json()).photoStorage !== true) throw new Error("PHOTO_STORAGE_DEPLOY_REQUIRED");
  if (Number(before.storageBytes) + Number(before.pendingBytes) > archiveStorageBudget) throw new Error("PHOTO_STORAGE_BUDGET_EXCEEDED");
  const directory = path.resolve("artifacts", "photo-storage", project, new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "before.json"), JSON.stringify(before, null, 2));
  const deadline = Date.now() + 15 * 60_000;
  let migrated = 0;
  while (Date.now() < deadline) {
    const page = await rpc<{ photos: Photo[] }>("page");
    if (!page.photos.length) break;
    for (const photo of page.photos) {
      const bytes = Buffer.from(photo.base64, "base64");
      if (photoDigest(bytes) !== photo.sha256) throw new Error("PHOTO_STORAGE_HASH_MISMATCH");
      const backup = path.join(directory, `${photo.sha256}.jpg`);
      try { await writeFile(backup, bytes, { flag: "wx", mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      if (photoDigest(await readFile(backup)) !== photo.sha256) throw new Error("PHOTO_STORAGE_BACKUP_MISMATCH");
      const reference = { sourceId: photo.sourceId, identityValue: photo.identityValue, thumbnailSha256: photo.thumbnailSha256,
        previewThumbnailSha256: photo.previewThumbnailSha256, sha256: photo.sha256 };
      await appendFile(path.join(directory, "backup-manifest.jsonl"), JSON.stringify(reference) + "\n");
      const image = await store.put(bytes);
      const answer = await rpc<{ ok: boolean }>("commit", { ...reference, image });
      if (answer.ok !== true) throw new Error("PHOTO_STORAGE_COMMIT_FAILED");
      await appendFile(path.join(directory, "receipts.jsonl"), JSON.stringify({ ...reference, image, verified: true }) + "\n");
      migrated++;
      if (migrated % 20 === 0) console.log(JSON.stringify({ migrated }));
    }
  }
  const after = await rpc<State>("status");
  const preserved = before.photos === after.photos && before.thumbnailProof === after.thumbnailProof && before.previewProof === after.previewProof;
  await writeFile(path.join(directory, "after.json"), JSON.stringify({ ...after, migrated, preserved }, null, 2));
  console.log(JSON.stringify({ migrated, pending: after.pending, preserved, databaseBytes: after.databaseBytes, photoTableBytes: after.photoTableBytes }));
  if (!preserved) throw new Error("PHOTO_STORAGE_CONCURRENT_CHANGE_REVIEW");
}
run().catch(error => {
  const code = error instanceof Error && /^PHOTO_STORAGE_[A-Z_]+$/.test(error.message) ? error.message : "PHOTO_STORAGE_MIGRATION_FAILED";
  console.error(JSON.stringify({ code })); process.exitCode = 1;
});
