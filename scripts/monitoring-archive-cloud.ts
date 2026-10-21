import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArchiveCloudStore, type StoredArchiveObject } from "../lib/monitoring/archive/cloud-store.ts";
import { archivePath, digest, packObject, unpackObject, type ArchiveManifest } from "../lib/monitoring/archive/format.ts";
import { archiveFile, verifyArchive } from "../lib/monitoring/archive/local.ts";

const [command, ...args] = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const project = option("--project"); const directory = option("--dir"); const localArchive = option("--archive");
const artifactBase = path.resolve("artifacts"); const root = path.resolve(directory ?? "artifacts/cloud-archive-2026-10-21");
const relative = path.relative(artifactBase, root);
if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("ARCHIVE_OUTPUT_FORBIDDEN");
type ExportPart = { table_name: string; part: number; path: string; rows: number; last_key: Record<string, unknown> };
type Snapshot = { id: string; state: string; tables: Record<string, { rows: number; keys: string[] }>; metadata: Record<string, unknown>; manifest_path: string | null };
type State = { runId: string | null; active: boolean; maintenance: boolean; storageBytes: number; databaseBytes: number; cutoff: string; eventFrom: string; snapshot: Snapshot | null };
async function save(name: string, bytes: Buffer | string) {
  archivePath(name); const target = path.join(root, name); await mkdir(path.dirname(target), { recursive: true });
  try { await writeFile(target, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST") || !Buffer.from(await readFile(target)).equals(Buffer.from(bytes))) throw error; }
}
async function run() {
  if (!project || !["state", "begin", "export", "publish-local", "seal", "restore-queue"].includes(command)) throw new Error("ARCHIVE_ARGUMENTS_INVALID");
  const client = new ArchiveCloudStore(project, process.env.MONITORING_SUPABASE_SERVICE_ROLE_KEY ?? "", process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (command === "state") return client.rpc("state");
  if (command === "begin") return client.rpc("begin");
  if (command === "publish-local") {
    if (!localArchive) throw new Error("ARCHIVE_ARGUMENTS_INVALID");
    await verifyArchive(localArchive, "manifest.json", message => console.log(message));
    const raw = await archiveFile(localArchive, "manifest.json"); const manifest = JSON.parse(raw.toString("utf8")) as ArchiveManifest;
    if (manifest.projectRef !== project) throw new Error("ARCHIVE_PROJECT_MISMATCH");
    const objects: StoredArchiveObject[] = [
      ...manifest.sources.map(source => ({ ...source.original, path: `afd/${source.original.path}`, kind: "original" as const,
        metadata: { sourceId: source.sourceId, fileSha256: source.sha256, parserVersion: source.parserVersion } })),
      ...manifest.parts.map(part => ({ ...part, path: `afd/${part.path}`, kind: "archive_rows" as const,
        metadata: { sourceId: part.sourceId, fileSha256: part.fileSha256, month: part.month, rows: part.rows, punches: part.punches } })),
    ];
    let next = 0; let done = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < objects.length) { const object = objects[next++]; await client.put(object, await archiveFile(localArchive, object.path.slice(4))); done++;
        if (done % 20 === 0) console.log(`Objetos privados conferidos: ${done}/${objects.length}`);
      }
    }));
    const packed = packObject("pending.gz", raw); const manifestPath = `afd/manifests/${digest(raw)}.json.gz`;
    await client.put({ ...packed.object, path: manifestPath, kind: "manifest", metadata: { type: "afd-manifest", files: manifest.sources.length } }, packed.compressed);
    await save("afd-cloud-manifest-receipt.json", JSON.stringify({ manifestPath, sha256: packed.object.sha256, objects: objects.length, verifiedRemotely: true }, null, 2) + "\n");
    return { objects: objects.length + 1, manifestPath, verifiedRemotely: true };
  }
  const state = await client.rpc<State>("state");
  if (!state.runId || !state.snapshot || !state.maintenance) throw new Error("ARCHIVE_RUN_REQUIRED");
  const runId = state.runId;
  if (command === "restore-queue") {
    const backup = JSON.parse(await readFile(path.join(root,"emergency-queue-manifest.json"),"utf8")) as {contract:{rows:number;sha256:string};parts:Array<{file:string;rows:number;sha256:string}>};
    const verified = JSON.parse(await readFile(path.join(root,"emergency-queue-verification.json"),"utf8")) as {verified:boolean;rows:number;sha256:string};
    if (!verified.verified || verified.rows!==backup.contract.rows || verified.sha256!==backup.contract.sha256) throw new Error("ARCHIVE_RESTORE_MISMATCH");
    let restored=0;
    for (const part of backup.parts) {
      archivePath(part.file); const raw=Buffer.from((await readFile(path.join(root,part.file),"utf8")).trim(),"base64");
      if(digest(raw)!==part.sha256)throw new Error("ARCHIVE_RESTORE_MISMATCH");
      const rows=JSON.parse(raw.toString("utf8"));if(rows.length!==part.rows)throw new Error("ARCHIVE_RESTORE_MISMATCH");
      await client.rpc("restore_queue",{runId,rows});restored+=rows.length;
    }
    if(restored!==backup.contract.rows)throw new Error("ARCHIVE_RESTORE_MISMATCH");
    return client.rpc("adopt_queue",{runId,...backup.contract});
  }
  if (command === "export") {
    const previous = (await client.rpc<{ parts: ExportPart[] }>("export_status", { runId })).parts;
    const tables = Object.entries(state.snapshot.tables); let nextTable = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (nextTable < tables.length) {
        const [table, contract] = tables[nextTable++];
        const done = previous.filter(part => part.table_name === table).sort((a, b) => a.part - b.part);
        let total = done.reduce((sum, part) => sum + part.rows, 0); let part = done.length; let after = done.at(-1)?.last_key;
        if (done.some((item, index) => item.part !== index)) throw new Error("ARCHIVE_EXPORT_GAP");
        console.log(`Exportando ${table}: ${total}/${contract.rows}`);
        while (total < contract.rows) {
          const page = await client.rpc<{ rows: Record<string, unknown>[]; next: Record<string, unknown> | null; expectedRows: number }>("page", { runId, table, ...(after ? { after } : {}), limit: 500 });
          if (!page.rows.length || !page.next || Number(page.expectedRows) !== contract.rows) throw new Error("ARCHIVE_EXPORT_INCOMPLETE");
          const raw = Buffer.from(JSON.stringify({ table, keys: contract.keys, rows: page.rows }) + "\n");
          const packed = packObject("pending.gz", raw); const objectPath = `snapshots/${runId}/${table}/${String(part).padStart(6, "0")}-${packed.object.sha256}.json.gz`;
          await save(objectPath, packed.compressed);
          await client.put({ ...packed.object, path: objectPath, kind: "snapshot", metadata: { runId, table, part, rows: page.rows.length } }, packed.compressed);
          await client.rpc("exported", { runId, table, part, path: objectPath, rows: page.rows.length, lastKey: page.next });
          total += page.rows.length; after = page.next; part++;
          if (part % 50 === 0) console.log(`${table}: ${total}/${contract.rows}`);
        }
        if (total !== contract.rows) throw new Error("ARCHIVE_EXPORT_COUNT_MISMATCH");
        console.log(`Conferido ${table}: ${total} registro(s)`);
      }
    }));
    return { runId, tables: tables.length, exported: true };
  }
  const catalog = (await client.rpc<{ objects: Array<StoredArchiveObject & { expanded_sha256: string; expanded_bytes: number }> }>("catalog", { prefix: `snapshots/${runId}/` })).objects.filter(object=>object.kind==="snapshot");
  const parts = (await client.rpc<{ parts: ExportPart[] }>("export_status", { runId })).parts;
  let verifyCursor=0;let verified=0;
  const results=await Promise.allSettled(Array.from({length:4},async()=>{
    while(verifyCursor<parts.length){const part=parts[verifyCursor++];
      const object = catalog.find(object => object.path === part.path); if (!object) throw new Error("ARCHIVE_OBJECT_NOT_STORED");
      const proofName=`seal-verified/${object.sha256}.json`;
      const proof={path:object.path,sha256:object.sha256,expandedSha256:object.expanded_sha256,rows:part.rows};
      let done=false;try{done=JSON.stringify(JSON.parse(await readFile(path.join(root,proofName),"utf8")))===JSON.stringify(proof);}catch{}
      if(!done){
        const bytes = await client.download(object); const decoded = JSON.parse(unpackObject({ ...object, expandedSha256: object.expanded_sha256, expandedBytes: object.expanded_bytes }, bytes).toString("utf8"));
        if (decoded.table !== part.table_name || decoded.rows.length !== part.rows) throw new Error("ARCHIVE_EXPORT_COUNT_MISMATCH");
        await save(proofName,JSON.stringify(proof));
      }
      verified++;if(verified%200===0)console.log(`Snapshot relido: ${verified}/${parts.length} partes`);
    }
  }));
  const failed=results.find(result=>result.status==="rejected");if(failed?.status==="rejected")throw failed.reason;
  const raw = Buffer.from(JSON.stringify({ version: 1, projectRef: project, runId, tables: state.snapshot.tables, parts, objects: catalog }, null, 2) + "\n");
  const packed = packObject("pending.gz", raw); const manifestPath = `snapshots/${runId}/manifest-${digest(raw)}.json.gz`;
  await save("database-snapshot-manifest.json", raw);
  await client.put({ ...packed.object, path: manifestPath, kind: "manifest", metadata: { runId, type: "database-snapshot", parts: parts.length } }, packed.compressed);
  await client.rpc("seal", { runId, manifestPath });
  return { runId, sealed: true, parts: parts.length, manifestPath };
}
try { console.log(JSON.stringify(await run())); }
catch (error) { console.error(error instanceof Error && /^ARCHIVE_[A-Z_]+$/.test(error.message) ? error.message : "ARCHIVE_CLOUD_FAILED"); process.exitCode = 1; }
