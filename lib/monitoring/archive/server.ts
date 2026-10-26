import "server-only";
import { z } from "zod";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { ArchiveCloudStore } from "./cloud-store";
import { configuredSupabaseProjectRef } from "../../supabase/storage-origin";
import { archiveObject,type CatalogObject } from "./prepare-cloud";
import { unpackObject } from "./format";
import { mergeIndexedPunch,parsePunchIndex,payrollWindow,type IndexedPunch } from "./punch-index";

export function serverArchiveStore() {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.MONITORING_SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new Error("ARCHIVE_SERVER_UNAVAILABLE");
 return new ArchiveCloudStore(configuredSupabaseProjectRef(url),key,url);
}
const scopeSchema=z.object({active:z.boolean(),maintenance:z.boolean(),cutoff:z.string(),bindings:z.array(z.object({
 sourceId:z.string(),identityType:z.enum(["cpf","pis"]),identityValue:z.string(),validFrom:z.string(),validTo:z.string().nullable(),
})),objects:z.array(z.unknown()),files:z.array(z.object({id:z.string(),sourceId:z.string(),sha256:z.string()}))});
const rawSchema=z.object({events:z.array(z.object({sourceId:z.string(),payload:z.object({key:z.string()}).passthrough()}).passthrough())}).passthrough();
const localDate=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"});
function dateOf(at:string){const parts=Object.fromEntries(localDate.formatToParts(new Date(at)).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}`;}

/** Caller must first authorize employeeId through the existing authenticated
 * history RPC or own the fenced worker claim. Never send this scope to a browser. */
export async function augmentArchivedInput(raw:unknown,period:{employeeId:string;start:string;end:string}) {
 const cutoff=payrollWindow(todayInSaoPaulo()).cutoff;
 if(period.start>=cutoff)return {input:raw,archive:undefined};
 const client=serverArchiveStore();const scope=scopeSchema.parse(await client.rpc("history_scope",period));
 if(scope.maintenance)throw new Error("ARCHIVE_MAINTENANCE");
 if(!scope.active)return {input:raw,archive:undefined};
 const events=rawSchema.parse(raw).events;const existing=new Set(events.map(event=>`${event.sourceId}:${event.payload.key}`));
 const earliest=Date.parse(`${period.start}T00:00:00-03:00`)-86400000;
 const latest=Math.min(Date.parse(`${scope.cutoff}T00:00:00-03:00`)-86400000,Date.parse(`${period.end}T00:00:00-03:00`)+2*86400000);
 const punches=new Map<string,{sourceId:string;punch:IndexedPunch}>();let next=0;
 const outcomes=await Promise.allSettled(Array.from({length:4},async()=>{
  while(next<scope.objects.length){
   const object=scope.objects[next++] as CatalogObject;
   const index=parsePunchIndex(JSON.parse(unpackObject(archiveObject(object),await client.download(object)).toString("utf8")));
   for(const punch of index.punches){
    const instant=Date.parse(punch.at);if(instant<earliest||instant>=latest)continue;const day=dateOf(punch.at);
    if(!scope.bindings.some(binding=>binding.sourceId===index.sourceId&&binding.identityType===punch.identityType&&binding.identityValue===punch.identityValue
      &&binding.validFrom<=day&&(!binding.validTo||binding.validTo>=day)))continue;
    const key=`${index.sourceId}:${punch.nsr}`;punches.set(key,{sourceId:index.sourceId,punch:mergeIndexedPunch(punches.get(key)?.punch,punch)});
   }
  }
 }));
 const failed=outcomes.find(outcome=>outcome.status==="rejected");if(failed?.status==="rejected")throw new Error("ARCHIVE_HISTORY_UNAVAILABLE");
 const appended=[];
 for(const {sourceId,punch} of punches.values()){
  if(existing.has(`${sourceId}:${punch.key}`))continue;
  appended.push({id:punch.eventId??`archive:${sourceId}:${punch.nsr}`,sourceId,eligible:!punch.conflicted,conflicted:punch.conflicted,
   payload:{key:punch.key,type:"punch",timestamp:punch.at,device:sourceId,classification:"authorized",eligible:!punch.conflicted,precisionSeconds:punch.precisionSeconds,
    identity:{type:punch.identityType,value:punch.identityValue},original:{}},
   provenance:punch.origins.map(origin=>({fileId:scope.files.find(file=>file.sourceId===sourceId&&file.sha256===origin.fileSha256)?.id,row:origin.line,sourceId}))});
 }
 const envelope=raw as Record<string,unknown>;
 return {input:{...envelope,events:[...events,...appended]},archive:{cutoff:scope.cutoff,used:true,records:appended.length}};
}
