import { z } from "zod";
import { dateSchema,periodSchema } from "@/lib/monitoring/contracts";
import { monitoringQuery,monitoringFailure,monitoringSession } from "@/lib/monitoring/server";
export async function GET(request:Request){
 const session=await monitoringSession();if(session.response)return session.response;
 const params=Object.fromEntries(new URL(request.url).searchParams);
 const parsed=z.object({employeeId:z.string().uuid(),date:dateSchema.optional(),offset:z.coerce.number().int().min(0).max(100000).default(0)}).safeParse(params);
 const period=periodSchema.safeParse(params);
 if(!parsed.success||!period.success)return Response.json({error:"Pessoa ou período inválido."},{status:400});
 try{return Response.json(await monitoringQuery('detail',{...parsed.data,...period.data}),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return monitoringFailure(error);}
}
