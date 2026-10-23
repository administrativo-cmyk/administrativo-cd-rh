import {ArchiveCloudStore} from "../lib/monitoring/archive/cloud-store.ts";
import {retainRecentMonths} from "../lib/monitoring/archive/retention.ts";

// Bounded maintenance using the same immutable cloud proof protocol as the
// scheduled server worker. Never bypasses manual/financial retention guards.
const args=process.argv.slice(2);
const value=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const project=value("--project");const pages=Number(value("--pages")??20);
async function run(){
 if(!project||!/^[a-z]{20}$/.test(project)||!Number.isInteger(pages)||pages<1||pages>1000)throw new Error("ARCHIVE_ARGUMENTS_INVALID");
 const client=new ArchiveCloudStore(project,process.env.MONITORING_SUPABASE_SERVICE_ROLE_KEY??"",process.env.NEXT_PUBLIC_SUPABASE_URL??"");
 const before=await client.rpc<{databaseBytes:number;storageBytes:number}>("state");
 const result=await retainRecentMonths(client,Date.now()+4*60*1000,pages);
 const after=await client.rpc<{databaseBytes:number;storageBytes:number}>("state");
 return {before:{databaseBytes:before.databaseBytes,storageBytes:before.storageBytes},...result,after:{databaseBytes:after.databaseBytes,storageBytes:after.storageBytes}};
}
run().then(value=>console.log(JSON.stringify(value))).catch(error=>{
 const code=error instanceof Error&&/^(ARCHIVE|MONITORING)_[A-Z_]+$/.test(error.message)?error.message:"MAINTENANCE_FAILED";
 console.error(JSON.stringify({code,message:"Manutenção interrompida; registros sem cópia verificada foram preservados."}));process.exitCode=1;
});
