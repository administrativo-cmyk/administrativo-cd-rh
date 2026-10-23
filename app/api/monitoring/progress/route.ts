import { filtersSchema } from "@/lib/monitoring/contracts";
import { monitoringFailure,monitoringQuery,monitoringSession } from "@/lib/monitoring/server";
import { processingProgressSchema } from "@/lib/monitoring/processing-progress";
export async function GET(request:Request){
 const session=await monitoringSession();if(session.response)return session.response;
 const filters=filtersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!filters.success)return Response.json({error:"Filtros inválidos."},{status:400});
 try{
  const progress=processingProgressSchema.parse(await monitoringQuery("progress",filters.data,request.signal));
  return Response.json(progress,{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return monitoringFailure(error);}
}
