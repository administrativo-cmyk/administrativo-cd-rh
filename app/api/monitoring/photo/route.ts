import { z } from "zod";
import { monitoringQuery,monitoringFailure,monitoringSession } from "@/lib/monitoring/server";
import { authorizedPhotoResponse } from "@/lib/monitoring/photo-storage-server";
export async function GET(request:Request){
 const session=await monitoringSession();if(session.response)return session.response;
 const id=new URL(request.url).searchParams.get('employeeId');
 if(id&&!z.string().uuid().safeParse(id).success)return new Response(null,{status:400});
 try{
  const full=new URL(request.url).searchParams.get('size')!=='avatar';
  const data=await monitoringQuery(id?'photo':'my_photo',{...(id?{employeeId:id}:{}),...(full?{photoVariant:'full'}:{})});
  return await authorizedPhotoResponse(data);
 }catch(error){return monitoringFailure(error);}
}
