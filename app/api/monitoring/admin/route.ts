import { monitoringQuery,monitoringFailure,monitoringSession } from "@/lib/monitoring/server";
export async function GET(request:Request){
 const session=await monitoringSession(true);if(session.response)return session.response;
 const offset=Number(new URL(request.url).searchParams.get('offset')??0);
 if(!Number.isInteger(offset)||offset<0||offset>100000)return Response.json({error:"Página inválida."},{status:400});
 try{return Response.json(await monitoringQuery('admin',{offset}),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return monitoringFailure(error);}
}
