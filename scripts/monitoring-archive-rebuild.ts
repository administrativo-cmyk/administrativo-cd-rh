import {readFile,writeFile,mkdir} from "node:fs/promises";
import path from "node:path";
import {ArchiveCloudStore,type StoredArchiveObject} from "../lib/monitoring/archive/cloud-store.ts";
import {archiveObject,type CatalogObject} from "../lib/monitoring/archive/prepare-cloud.ts";
import {archivePath,digest,packObject,unpackObject} from "../lib/monitoring/archive/format.ts";

const [command,...args]=process.argv.slice(2);const option=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
type Row=Record<string,unknown>;
type Part={table:string;rows:number;object:StoredArchiveObject};
type Plan={version:1;runId:string;cutoff:string;eventFrom:string;tableCounts:Record<string,number>;parts:Part[]};
const tables=["public.monitoring_events","public.monitoring_occurrences","public.monitoring_results","public.monitoring_jobs"];
async function run(){
 const project=option("--project");const directory=option("--dir");if(!project||!directory||!["prepare","start","restore","activate"].includes(command))throw new Error("ARCHIVE_ARGUMENTS_INVALID");
 const root=path.resolve(directory);const relative=path.relative(path.resolve("artifacts"),root);if(!relative||relative.startsWith("..")||path.isAbsolute(relative))throw new Error("ARCHIVE_OUTPUT_FORBIDDEN");
 const client=new ArchiveCloudStore(project,process.env.MONITORING_SUPABASE_SERVICE_ROLE_KEY??"",process.env.NEXT_PUBLIC_SUPABASE_URL??"");
 const state=await client.rpc<{runId:string;maintenance:boolean;active:boolean;snapshot:{state:string;metadata:{cutoff:string};tables:Record<string,{rows:number;keys:string[]}>}}>("state");
 const save=async(name:string,bytes:Buffer|string)=>{archivePath(name);const target=path.join(root,name);await mkdir(path.dirname(target),{recursive:true});
  try{await writeFile(target,bytes,{flag:"wx",mode:0o600});}catch(error){if(!(error&&typeof error==="object"&&"code"in error&&error.code==="EEXIST")||!Buffer.from(await readFile(target)).equals(Buffer.from(bytes)))throw error;}};
 if(command==="activate")return client.rpc("activate",{runId:state.runId});
 if(!state.maintenance||!state.runId)throw new Error("ARCHIVE_RUN_REQUIRED");
 if(command==="start")return client.rpc("rebuild_start",{runId:state.runId});
 if(command==="restore"){
  const plan=JSON.parse(await readFile(path.join(root,"working-manifest.json"),"utf8")) as Plan;
  if(plan.runId!==state.runId)throw new Error("ARCHIVE_RUN_REQUIRED");
  for(const table of tables){let restored=0;
   const parts=plan.parts.filter(part=>part.table===table);let cursor=0;
   const results=await Promise.allSettled(Array.from({length:4},async()=>{while(cursor<parts.length){const part=parts[cursor++];
    archivePath(part.object.path);const raw=unpackObject(part.object,await readFile(path.join(root,part.object.path))).toString("utf8");
    await client.rpc("restore",{runId:plan.runId,path:part.object.path,raw});restored+=part.rows;
    if(restored%25000===0)console.log(`Restaurando ${table}: ${restored}/${plan.tableCounts[table]}`);
   }}));
   const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
   console.log(`Restaurado ${table}: ${restored} registro(s)`);
  }
  return client.rpc("rebuild_status",{runId:plan.runId});
 }
 if(state.snapshot.state!=="sealed")throw new Error("ARCHIVE_SNAPSHOT_NOT_SEALED");
 const snapshot=JSON.parse(await readFile(path.join(root,"database-snapshot-manifest.json"),"utf8")) as {runId:string;objects:CatalogObject[]};
 if(snapshot.runId!==state.runId)throw new Error("ARCHIVE_RUN_REQUIRED");
 const cutoff=state.snapshot.metadata.cutoff;const eventFrom=new Date(Date.parse(`${cutoff}T00:00:00-03:00`)-86400000).toISOString();
 const hotIds=new Set<string>();const sourceKinds=new Map<string,string>();const fileSources=new Map<string,string>();
 const rowsFor=async function*(table:string){let count=0;
  for(const object of snapshot.objects.filter(object=>object.metadata.table===table).sort((a,b)=>Number(a.metadata.part)-Number(b.metadata.part))){
   archivePath(object.path);const page=JSON.parse(unpackObject(archiveObject(object),await readFile(path.join(root,object.path))).toString("utf8")) as {table:string;rows:Row[]};
   if(page.table!==table||page.rows.length!==object.metadata.rows)throw new Error("ARCHIVE_SNAPSHOT_INVALID");
   for(const row of page.rows){count++;yield row;}
  }
  if(count!==state.snapshot.tables[table].rows)throw new Error("ARCHIVE_EXPORT_COUNT_MISMATCH");
 };
 for await(const row of rowsFor("public.monitoring_sources"))sourceKinds.set(String(row.id),String(row.kind));
 for await(const row of rowsFor("public.monitoring_files"))fileSources.set(String(row.id),String(row.source_id));
 const plan:Plan={version:1,runId:state.runId,cutoff,eventFrom,tableCounts:{},parts:[]};
 for(const table of tables){
  let count=0;let buffer:Row[]=[];let size=0;let partNumber=0;
  const flush=async()=>{if(!buffer.length)return;
   const raw=Buffer.from(JSON.stringify({table,keys:state.snapshot.tables[table].keys,rows:buffer})+"\n");
   if(raw.length>1900000)throw new Error("ARCHIVE_WORKING_PART_LIMIT");
   const packed=packObject("pending.gz",raw);const object:StoredArchiveObject={...packed.object,path:`rebuild/${state.runId}/${table}/${String(partNumber++).padStart(6,"0")}-${packed.object.sha256}.json.gz`,kind:"snapshot",
    metadata:{type:"working-set",runId:state.runId,table,rows:buffer.length}};
   await save(object.path,packed.compressed);await client.put(object,packed.compressed);plan.parts.push({table,rows:buffer.length,object});buffer=[];size=0;
  };
  for await(const original of rowsFor(table)){
   let row=original;let keep=false;
   if(table==="public.monitoring_events"){keep=Date.parse(String(row.occurred_at))>=Date.parse(eventFrom);if(keep)hotIds.add(String(row.id));}
   else if(table==="public.monitoring_occurrences"){
    keep=row.event_id===null||hotIds.has(String(row.event_id));
    if(keep&&sourceKinds.get(fileSources.get(String(row.file_id))??"")==="afd"){
     const payload=row.payload as {issues?:Array<{severity:string}>;event?:unknown};
     row={...row,payload:{issues:(payload.issues??[]).filter(issue=>issue.severity==="error"),originalPreserved:true,...(payload.event?{event:true}:{})}};
    }
   }else if(table==="public.monitoring_results")keep=row.active===true&&String(row.operational_date)>=cutoff;
   else keep=String(row.operational_date)>=cutoff;
   if(!keep)continue;
   const length=Buffer.byteLength(JSON.stringify(row));if(length>1500000)throw new Error("ARCHIVE_WORKING_PART_LIMIT");
   if(buffer.length>=500||size+length>1500000)await flush();buffer.push(row);size+=length;count++;
  }
  await flush();plan.tableCounts[table]=count;console.log(`Conjunto operacional ${table}: ${count}/${state.snapshot.tables[table].rows}`);
 }
 const raw=Buffer.from(JSON.stringify(plan,null,2)+"\n");const packed=packObject("pending.gz",raw);
 const object:StoredArchiveObject={...packed.object,path:`rebuild/${state.runId}/manifest-${digest(raw)}.json.gz`,kind:"manifest",metadata:{type:"working-set",runId:state.runId}};
 await save("working-manifest.json",raw);await client.put(object,packed.compressed);
 await client.rpc("rebuild_plan",{runId:state.runId,manifestPath:object.path,tableCounts:plan.tableCounts,cutoff,eventFrom});
 return {runId:plan.runId,tableCounts:plan.tableCounts,parts:plan.parts.length,verifiedRemotely:true};
}
try{console.log(JSON.stringify(await run()));}catch(error){console.error(error instanceof Error&&/^ARCHIVE_[A-Z_]+$/.test(error.message)?error.message:"ARCHIVE_REBUILD_FAILED");process.exitCode=1;}
