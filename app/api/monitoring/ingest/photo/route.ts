import { z } from 'zod';
import { allowedIngestSource,validWorkerToken,hashBytes } from '@/lib/monitoring/ingest-security';
import { boundedJson,monitoringFailure,workerClient } from '@/lib/monitoring/server';
import { createPhotoThumbnail,InvalidPhotoError } from '@/lib/monitoring/photo-thumbnail';
export const runtime='nodejs';
const schema=z.object({sourceId:z.string().min(1).max(100),identityValue:z.string().min(1).max(100),sha256:z.string().regex(/^[0-9a-f]{64}$/),mimeType:z.enum(['image/jpeg','image/png','image/webp']),base64:z.string().max(2800000).regex(/^[A-Za-z0-9+/]*={0,2}$/)});
export async function POST(request:Request){
 if(!validWorkerToken(request.headers.get('authorization'),process.env.MONITORING_INGEST_TOKEN))return Response.json({error:'Credencial inválida.'},{status:401});
 let raw:unknown;try{raw=await boundedJson(request,2900000);}catch{return Response.json({error:'Foto inválida.'},{status:400});}
 const parsed=schema.safeParse(raw);if(!parsed.success)return Response.json({error:'Foto inválida.'},{status:400});
 if(!allowedIngestSource(parsed.data.sourceId))return Response.json({error:'Fonte não autorizada.'},{status:403});
 const bytes=Buffer.from(parsed.data.base64,'base64');if(hashBytes(bytes)!==parsed.data.sha256)return Response.json({error:'Hash divergente.'},{status:400});
 try{
  const thumbnail=await createPhotoThumbnail(bytes);
  const {error}=await workerClient().rpc('monitoring_ingest',{p_data:{photo:{...parsed.data,sha256:hashBytes(thumbnail),mimeType:'image/jpeg',base64:thumbnail.toString('base64')}}});
  if(error)throw error;return Response.json({accepted:true},{headers:{'Cache-Control':'no-store'}});
 }catch(error){if(error instanceof InvalidPhotoError)return Response.json({error:'Foto inválida.',code:error.code},{status:400,headers:{'Cache-Control':'no-store'}});return monitoringFailure(error);}
}
