// Scoped maintenance: cloud copy + verified reread precede every exact-row removal.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArchiveCloudStore } from "../lib/monitoring/archive/cloud-store.ts";
import { digest, packObject } from "../lib/monitoring/archive/format.ts";

async function run() {
  const project = process.argv[process.argv.indexOf("--project") + 1];
  const client = new ArchiveCloudStore(project, process.env.MONITORING_SUPABASE_SERVICE_ROLE_KEY ?? "", process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const directory = path.resolve("artifacts", "daily-call-retention");
  await mkdir(directory, { recursive: true });
  const receipt = { project, startedAt: new Date().toISOString(), rows: 0, compressedBytes: 0, complete: false, objects: [] };
  const file = path.join(directory, `${Date.now()}.json`);
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline - 12000) {
    const page = await client.rpc("retention_page", { table: "public.chamada_diaria" });
    if (!page.rows) { receipt.complete = true; break; }
    if (page.table !== "public.chamada_diaria" || !page.raw || digest(Buffer.from(page.raw)) !== page.sha256) throw new Error("ARCHIVE_RETENTION_INVALID");
    const packed = packObject("pending.gz", Buffer.from(page.raw));
    const object = { ...packed.object, path: `retention/public.chamada_diaria/${packed.object.sha256}.json.gz`, kind: "snapshot", metadata: { type: "rolling-retention", table: page.table, rows: page.rows } };
    await client.put(object, packed.compressed);
    const result = await client.rpc("retention_commit", { path: object.path, raw: page.raw });
    if (result.stale) throw new Error("ARCHIVE_RETENTION_STALE");
    if (!result.ok) throw new Error("ARCHIVE_RETENTION_INVALID");
    receipt.rows += result.rows ?? 0;
    receipt.compressedBytes += packed.compressed.length;
    receipt.objects.push({ path: object.path, sha256: object.sha256, rows: result.rows ?? 0 });
    await writeFile(file, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    if (receipt.objects.length % 5 === 0) console.log(JSON.stringify({ archivedRows: receipt.rows, verifiedObjects: receipt.objects.length }));
  }
  await writeFile(file, JSON.stringify({ ...receipt, finishedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ rows: receipt.rows, compressedBytes: receipt.compressedBytes, complete: receipt.complete, receipt: file }));
}
run().catch(error => { console.error(error instanceof Error && /^ARCHIVE_[A-Z_]+$/.test(error.message) ? error.message : "ARCHIVE_RETENTION_FAILED"); process.exitCode = 1; });
