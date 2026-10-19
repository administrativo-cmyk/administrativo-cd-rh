import { groupChangeFiltersSchema,groupChangesSchema } from "@/lib/monitoring/group-changes";
import { monitoringOperation } from "@/lib/monitoring/operations-server";
import { monitoringFailure,monitoringSession } from "@/lib/monitoring/server";

export async function GET(request:Request){
 const session=await monitoringSession(true);if(session.response)return session.response;
 const parsed=groupChangeFiltersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!parsed.success)return Response.json({error:"Revise os filtros da comparação de grupos."},{status:400});
 try{return Response.json(groupChangesSchema.parse(await monitoringOperation("monitoring_defense_group_changes","list",parsed.data)),{headers:{"Cache-Control":"private, no-store"}});}
 catch(error){return monitoringFailure(error);}
}
