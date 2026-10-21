import { parseAfd } from "../ingestion/parsers.ts";
import type { IngestionSource } from "../ingestion/types.ts";
import { digest,packObject,unpackObject,type ArchiveObject } from "./format.ts";
import { ArchiveCloudStore,type StoredArchiveObject } from "./cloud-store.ts";
import { equivalentPunch,indexedImport,indexMetadata,mergeIndexedPunch,parsePunchIndex,shardFor,type IndexedPunch,type PunchIndex } from "./punch-index.ts";

export type CatalogObject = StoredArchiveObject & { expanded_sha256?:string;expanded_bytes?:number };
export const archiveObject = (object:CatalogObject):ArchiveObject=>({...object,expandedSha256:object.expandedSha256??object.expanded_sha256!,expandedBytes:object.expandedBytes??object.expanded_bytes!});
export async function publishIndex(client:ArchiveCloudStore,index:PunchIndex,prefix="indices") {
  parsePunchIndex(index); const packed=packObject("pending.gz",Buffer.from(JSON.stringify(index)+"\n"));
  const object:StoredArchiveObject={...packed.object,path:`${prefix}/${index.sourceId}/${index.shard}/${packed.object.sha256}.json.gz`,kind:"nsr_index",metadata:indexMetadata(index)};
  await client.put(object,packed.compressed);
  await client.rpc("register_index",{sourceId:index.sourceId,shard:index.shard,path:object.path,rows:index.punches.length});return object;
}
export async function registerArchivedFile(client:ArchiveCloudStore,file:{sourceId:string;sha256:string;parserVersion:string;rows:number;punches:number;originalPath:string;indexPaths:string[];conflictNsrs?:string[];baseManifest?:string}) {
  const packed=packObject("pending.gz",Buffer.from(JSON.stringify({version:1,...file})+"\n"));
  const object:StoredArchiveObject={...packed.object,path:`afd/files/${file.sourceId}/${file.sha256}/${packed.object.sha256}.json.gz`,kind:"manifest",
    metadata:{type:"afd-file",sourceId:file.sourceId,fileSha256:file.sha256,parserVersion:file.parserVersion,rows:file.rows,punches:file.punches,conflictNsrs:file.conflictNsrs??[]}};
  await client.put(object,packed.compressed);
  await client.rpc("register_file",{...file,manifestPath:object.path});return object;
}

/** Called before any batch is committed. Immutable original and NSR index are
 * reread and verified first; only then is the complete file receipt registered. */
export async function ensureArchivedSnapshot(client:ArchiveCloudStore,job:{source:Omit<IngestionSource,"root">;sha256:string;byteLength:number;parserVersion:string},bytes:Buffer) {
  const policy=await client.rpc<{active:boolean;maintenance:boolean;cutoff:string;eventFrom:string}>("policy");
  if(!policy.active||job.source.kind!=="afd")return policy;
  if(policy.maintenance)throw new Error("ARCHIVE_MAINTENANCE");
  if(bytes.length!==job.byteLength||digest(bytes)!==job.sha256)throw new Error("ARCHIVE_INPUT_HASH_MISMATCH");
  const fileKey={sourceId:job.source.id,sha256:job.sha256,parserVersion:job.parserVersion};
  if((await client.rpc<{file:unknown}>("file",fileKey)).file)return policy;
  const parsed=parseAfd(bytes,{...job.source,root:""});
  if(parsed.skipped||parsed.parserVersion!==job.parserVersion)throw new Error("ARCHIVE_PARSER_MISMATCH");
  const shards=[...new Set(parsed.occurrences.flatMap(row=>row.event?.nsr?[shardFor(row.event.nsr)]:[]))];
  const objects:CatalogObject[]=[];
  for(let i=0;i<shards.length;i+=100)objects.push(...(await client.rpc<{objects:CatalogObject[]}>("indices",{sourceId:job.source.id,shards:shards.slice(i,i+100)})).objects);
  const known=new Map<string,IndexedPunch>();
  let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(cursor<objects.length){const object=objects[cursor++];const index=parsePunchIndex(JSON.parse(unpackObject(archiveObject(object),await client.download(object)).toString("utf8")));
      if(index.sourceId!==job.source.id)throw new Error("ARCHIVE_INDEX_INVALID");
      for(const punch of index.punches)known.set(punch.nsr,mergeIndexedPunch(known.get(punch.nsr),punch));
    }
  }));
  const changed=new Map<number,Map<string,IndexedPunch>>();const conflicts=new Set<string>();
  for(const row of parsed.occurrences)if(row.event){
    const punch=indexedImport(row.event,row.payloadHash,[{fileSha256:parsed.sha256,line:row.line}]);const previous=known.get(punch.nsr);
    if(previous?.conflicted||previous&&!equivalentPunch(previous,punch))conflicts.add(punch.nsr);
    if(!previous||!equivalentPunch(previous,punch)||punch.precisionSeconds<previous.precisionSeconds){
      const shard=shardFor(punch.nsr);if(!changed.has(shard))changed.set(shard,new Map());
      const merged=mergeIndexedPunch(previous,punch);changed.get(shard)!.set(punch.nsr,merged);known.set(punch.nsr,merged);
    }
  }
  if(conflicts.size>5000)throw new Error("ARCHIVE_CONFLICT_LIMIT");
  const original=packObject(`afd/originals/${job.source.id}/${job.sha256}.txt.gz`,bytes);
  await client.put({...original.object,kind:"original",metadata:{sourceId:job.source.id,fileSha256:job.sha256,parserVersion:job.parserVersion}},original.compressed);
  const paths=objects.map(object=>object.path);
  for(const [shard,rows] of changed){const published=await publishIndex(client,{version:1,sourceId:job.source.id,shard,punches:[...rows.values()].sort((a,b)=>a.nsr.localeCompare(b.nsr))});paths.push(published.path);}
  await registerArchivedFile(client,{...fileKey,rows:parsed.occurrences.length,punches:parsed.occurrences.filter(row=>!!row.event).length,
    originalPath:original.object.path,indexPaths:paths,conflictNsrs:[...conflicts].sort()});
  return policy;
}
