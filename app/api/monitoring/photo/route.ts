import { z } from "zod";
import { monitoringQuery,monitoringFailure,monitoringSession } from "@/lib/monitoring/server";
const photo=z.object({mimeType:z.enum(['image/jpeg','image/png','image/webp']),base64:z.string(),sha256:z.string()}).nullable();
export async function GET(request:Request){
 const session=await monitoringSession();if(session.response)return session.response;
 const id=new URL(request.url).searchParams.get('employeeId');
 if(id&&!z.string().uuid().safeParse(id).success)return new Response(null,{status:400});
 try{
  const full=new URL(request.url).searchParams.get('size')!=='avatar';
  const data=photo.parse(await monitoringQuery(id?'photo':'my_photo',{...(id?{employeeId:id}:{}),...(full?{photoVariant:'full'}:{})}));
  if(!data)return new Response(null,{status:404,headers:{'Cache-Control':'private, no-store'}});
  return new Response(Buffer.from(data.base64,'base64'),{headers:{'Content-Type':data.mimeType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){return monitoringFailure(error);}
}
