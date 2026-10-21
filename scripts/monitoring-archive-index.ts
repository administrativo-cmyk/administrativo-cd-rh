import {readFile,writeFile,mkdir} from "node:fs/promises";
import path from "node:path";
import {ArchiveCloudStore} from "../lib/monitoring/archive/cloud-store.ts";
import {archiveObject,publishIndex,registerArchivedFile,type CatalogObject} from "../lib/monitoring/archive/prepare-cloud.ts";
import {partRows,unpackObject,type ArchiveManifest} from "../lib/monitoring/archive/format.ts";
import {archiveFile} from "../lib/monitoring/archive/local.ts";
import {indexedImport,mergeIndexedPunch,shardFor,type IndexedPunch} from "../lib/monitoring/archive/punch-index.ts";
import type {CanonicalImportEvent} from "../lib/monitoring/ingestion/types.ts";

const args=process.argv.slice(2);const option=(key:string)=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};
async function run(){
 const project=option("--project");const local=option("--archive");const directory=option("--dir");if(!project||!local||!directory)throw new Error("ARCHIVE_ARGUMENTS_INVALID");
 const root=path.resolve(directory);const relative=path.relative(path.resolve("artifacts"),root);
 if(!relative||relative.startsWith("..")||path.isAbsolute(relative))throw new Error("ARCHIVE_OUTPUT_FORBIDDEN");
 const client=new ArchiveCloudStore(project,process.env.MONITORING_SUPABASE_SERVICE_ROLE_KEY??"",process.env.NEXT_PUBLIC_SUPABASE_URL??"");
 const state=await client.rpc<{runId:string;maintenance:boolean;snapshot:{state:string}}>("state");if(!state.maintenance||state.snapshot.state!=="sealed")throw new Error("ARCHIVE_SNAPSHOT_NOT_SEALED");
 const manifest=JSON.parse((await archiveFile(local,"manifest.json")).toString("utf8")) as ArchiveManifest;
 if(manifest.projectRef!==project)throw new Error("ARCHIVE_PROJECT_MISMATCH");
 const maps=new Map<string,Map<number,Map<string,IndexedPunch>>>();
 const put=(sourceId:string,punch:IndexedPunch)=>{if(!maps.has(sourceId))maps.set(sourceId,new Map());const groups=maps.get(sourceId)!;const shard=shardFor(punch.nsr);
  if(!groups.has(shard))groups.set(shard,new Map());const rows=groups.get(shard)!;rows.set(punch.nsr,mergeIndexedPunch(rows.get(punch.nsr),punch));};
 for(const part of manifest.parts)for(const row of partRows(unpackObject(part,await archiveFile(local,part.path))))if(row.occurrence.event)
  put(row.sourceId,indexedImport(row.occurrence.event,row.occurrence.payloadHash,[{fileSha256:row.fileSha256,line:row.occurrence.line}]));
 console.log("Índices dos dois AFDs completos preparados");
 const objects=(await client.rpc<{objects:CatalogObject[]}>("catalog",{prefix:`snapshots/${state.runId}/public.monitoring_events/`})).objects;
 let overlaid=0;
 for(const object of objects){
  const compressed=await readFile(path.join(root,object.path));const page=JSON.parse(unpackObject(archiveObject(object),compressed).toString("utf8")) as {table:string;rows:Array<{id:string;source_id:string;payload_hash:string;event_type:string;payload:CanonicalImportEvent;conflicted:boolean;nsr:string}>};
  if(page.table!=="public.monitoring_events")throw new Error("ARCHIVE_SNAPSHOT_INVALID");
  for(const row of page.rows)if(row.event_type==="punch"){
   const punch=indexedImport(row.payload,row.payload_hash,[{snapshotPath:object.path,eventId:row.id}]);punch.eventId=row.id;punch.conflicted=row.conflicted;
   put(row.source_id,punch);overlaid++;
  }
 }
 const paths=new Map<string,string[]>();let unique=0,conflicts=0;
 for(const [sourceId,groups] of maps){
  const objects:string[]=[];
  for(const [shard,rows] of [...groups].sort(([a],[b])=>a-b)){
   const punches=[...rows.values()].sort((a,b)=>a.nsr.localeCompare(b.nsr));const object=await publishIndex(client,{version:1,sourceId,shard,punches},"indices/bootstrap");
   objects.push(object.path);unique+=punches.length;conflicts+=punches.filter(row=>row.conflicted).length;
  }
  paths.set(sourceId,objects);console.log(`${sourceId}: ${objects.length} parte(s) de índice conferida(s)`);
 }
 const receipt=JSON.parse(await readFile(path.join(root,"afd-cloud-manifest-receipt.json"),"utf8")) as {manifestPath:string};
 for(const file of manifest.sources){
  const conflictNsrs=[...(maps.get(file.sourceId)?.values()??[])].flatMap(rows=>[...rows.values()].filter(row=>row.conflicted).map(row=>row.nsr));
  await registerArchivedFile(client,{sourceId:file.sourceId,sha256:file.sha256,parserVersion:file.parserVersion,rows:file.rows,punches:file.punches,
   originalPath:`afd/${file.original.path}`,baseManifest:receipt.manifestPath,indexPaths:paths.get(file.sourceId)??[],conflictNsrs});
 }
 const proof={uniquePunches:unique,canonicalDatabasePunchesOverlaid:overlaid,conflicts,files:manifest.sources.length,verifiedRemotely:true};
 await mkdir(root,{recursive:true});await writeFile(path.join(root,"nsr-index-proof.json"),JSON.stringify(proof,null,2)+"\n",{flag:"wx",mode:0o600});return proof;
}
try{console.log(JSON.stringify(await run()));}catch(error){console.error(error instanceof Error&&/^ARCHIVE_[A-Z_]+$/.test(error.message)?error.message:"ARCHIVE_INDEX_FAILED");process.exitCode=1;}
