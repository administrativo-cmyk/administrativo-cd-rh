import {z} from "zod";
import type {ArchiveCloudStore} from "./cloud-store";
import {digest,unpackObject} from "./format";

const referenceSchema=z.object({path:z.string(),id:z.string().uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
const objectSchema=z.object({path:z.string(),sha256:z.string(),bytes:z.number().int().positive(),expanded_sha256:z.string(),expanded_bytes:z.number().int().positive()});
const pageSchema=z.object({table:z.literal("public.monitoring_result_details"),rows:z.array(z.object({id:z.string().uuid(),raw:z.string()})).max(250)});

/** Call only after the employee-scoped authenticated detail RPC succeeds.
 * A cloud page may contain other employees; only authorized result IDs leave
 * this function. No pointer or storage credential is sent to the browser. */
export async function hydrateResultDetails(raw:unknown,getClient:()=>ArchiveCloudStore):Promise<unknown>{
 if(!raw||typeof raw!=="object"||!("results" in raw)||!Array.isArray(raw.results))return raw;
 const rows=raw.results as Array<Record<string,unknown>>;
 const refs=rows.flatMap((row,index)=>{
  const result=row.result;
  if(!result||typeof result!=="object"||!("archiveDetail" in result))return [];
  return [{index,...referenceSchema.parse(result.archiveDetail)}];
 });
 if(!refs.length)return raw;
 const client=getClient();const paths=[...new Set(refs.map(ref=>ref.path))];
 const catalog=z.object({objects:z.array(objectSchema)}).parse(await client.rpc("details_objects",{paths}));
 const hydrated=new Map<number,Record<string,unknown>>();let next=0;
 const outcomes=await Promise.allSettled(Array.from({length:Math.min(4,paths.length)},async()=>{
  while(next<paths.length){
   const path=paths[next++];const object=catalog.objects.find(object=>object.path===path);
   if(!object)throw new Error("ARCHIVE_RESULT_UNAVAILABLE");
   const bytes=await client.download(object);
   const page=pageSchema.parse(JSON.parse(unpackObject({...object,expandedSha256:object.expanded_sha256,expandedBytes:object.expanded_bytes},bytes).toString("utf8")));
   if(new Set(page.rows.map(row=>row.id)).size!==page.rows.length)throw new Error("ARCHIVE_RESULT_INVALID");
   for(const ref of refs.filter(ref=>ref.path===path)){
    const row=page.rows.find(row=>row.id===ref.id);
    if(!row||digest(row.raw)!==ref.sha256)throw new Error("ARCHIVE_RESULT_INVALID");
    hydrated.set(ref.index,z.record(z.unknown()).parse(JSON.parse(row.raw)));
   }
  }
 }));
 const failed=outcomes.find(outcome=>outcome.status==="rejected");if(failed?.status==="rejected")throw failed.reason;
 if(hydrated.size!==refs.length)throw new Error("ARCHIVE_RESULT_UNAVAILABLE");
 return {...raw,results:rows.map((row,index)=>hydrated.has(index)?{...row,result:hydrated.get(index)}:row)};
}
