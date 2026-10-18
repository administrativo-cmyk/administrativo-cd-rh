import { filtersSchema } from "@/lib/monitoring/contracts";
import { loadMonitoring,monitoringFailure,monitoringSession } from "@/lib/monitoring/server";
export async function GET(request:Request){
 const session=await monitoringSession();if(session.response)return session.response;
 const parsed=filtersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!parsed.success)return Response.json({error:"Filtros inválidos."},{status:400});
 try{return Response.json(await loadMonitoring(parsed.data),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return monitoringFailure(error);}
}
