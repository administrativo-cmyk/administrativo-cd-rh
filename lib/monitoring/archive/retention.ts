import {ArchiveCloudStore,type StoredArchiveObject} from "./cloud-store.ts";
import {digest,packObject} from "./format.ts";

/** Original files never enter this deletion path. Only exact rows whose immutable
 * cloud copy was reread and verified can leave the operational database. */
export async function retainRecentMonths(client:ArchiveCloudStore,deadline:number,maxPages=20){
 const policy=await client.rpc<{active:boolean;maintenance:boolean}>("policy");
 if(!policy.active||policy.maintenance)return {pending:false,archived:0};
 let archived=0,pages=0,pending=true;
 while(pages<maxPages&&Date.now()<deadline-12000){
  const page=await client.rpc<{raw?:string;sha256?:string;table?:string;rows:number}>("retention_page");
  if(!page.rows){pending=false;break;}
  if(!page.raw||!page.table||digest(Buffer.from(page.raw))!==page.sha256)throw new Error("ARCHIVE_RETENTION_INVALID");
  const packed=packObject("pending.gz",Buffer.from(page.raw));
  const object:StoredArchiveObject={...packed.object,path:`retention/${page.table}/${page.sha256}.json.gz`,kind:"snapshot",metadata:{type:"rolling-retention",table:page.table,rows:page.rows}};
  await client.put(object,packed.compressed);
  const result=await client.rpc<{ok:boolean;rows?:number;stale?:boolean}>("retention_commit",{path:object.path,raw:page.raw});
  if(result.stale)break;
  if(!result.ok)throw new Error("ARCHIVE_RETENTION_INVALID");
  archived+=result.rows??0;pages++;
 }
 await client.rpc("retention_done",{pending});return {pending,archived};
}
