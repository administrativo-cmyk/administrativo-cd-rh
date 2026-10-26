import { z } from 'zod';
import { allowedIngestSource,validWorkerToken,hashBytes } from '@/lib/monitoring/ingest-security';
import { boundedJson,monitoringFailure,workerClient } from '@/lib/monitoring/server';
import { createPhotoPreview,createPhotoThumbnail,readOriginalPhoto,InvalidPhotoError } from '@/lib/monitoring/photo-thumbnail';
import { serverPhotoStorage } from '@/lib/monitoring/photo-storage-server';
export const runtime='nodejs';
const schema=z.object({sourceId:z.string().min(1).max(100),identityValue:z.string().min(1).max(100),sha256:z.string().regex(/^[0-9a-f]{64}$/),mimeType:z.enum(['image/jpeg','image/png','image/webp']),base64:z.string().max(2800000).regex(/^[A-Za-z0-9+/]*={0,2}$/),insertOnly:z.boolean().optional()});
const insertOnlyResult=z.object({ok:z.literal(true),insertOnly:z.literal(true),status:z.enum(['inserted','replayed']),sha256:z.string().regex(/^[0-9a-f]{64}$/)});
export async function GET(request:Request){
 if(!validWorkerToken(request.headers.get('authorization'),process.env.MONITORING_INGEST_TOKEN))return Response.json({error:'Credencial inválida.'},{status:401});
 return Response.json({insertOnly:true,photoPreview:true,photoStorage:true,photoOriginal:true,protocolVersion:1},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request){
 if(!validWorkerToken(request.headers.get('authorization'),process.env.MONITORING_INGEST_TOKEN))return Response.json({error:'Credencial inválida.'},{status:401});
 let raw:unknown;try{raw=await boundedJson(request,2900000);}catch{return Response.json({error:'Foto inválida.'},{status:400});}
 const parsed=schema.safeParse(raw);if(!parsed.success)return Response.json({error:'Foto inválida.'},{status:400});
 if(!allowedIngestSource(parsed.data.sourceId))return Response.json({error:'Fonte não autorizada.'},{status:403});
 const bytes=Buffer.from(parsed.data.base64,'base64');if(hashBytes(bytes)!==parsed.data.sha256)return Response.json({error:'Hash divergente.'},{status:400});
 try{
  const thumbnail=await createPhotoThumbnail(bytes);
  const storedHash=hashBytes(thumbnail);
  const photo={...parsed.data,sha256:storedHash,mimeType:'image/jpeg',base64:thumbnail.toString('base64')};
  const client=workerClient();
  const capability=await client.rpc('monitoring_photo_storage',{p_action:'capabilities',p_data:{}});
  if(capability.error&&capability.error.code!=='PGRST202')throw capability.error;
  const storageReady=!capability.error;
  if(storageReady&&(!capability.data||typeof capability.data!=='object'||Array.isArray(capability.data)||capability.data.photoStorage!==true))throw new Error('PHOTO_STORAGE_UNCONFIRMED');
  const insertOnly=parsed.data.insertOnly===true;
  const originalReady=storageReady&&capability.data!==null&&typeof capability.data==='object'&&!Array.isArray(capability.data)&&capability.data.photoOriginal===true;
  const fullPhoto=originalReady?await readOriginalPhoto(bytes):{bytes:await createPhotoPreview(bytes),mimeType:'image/jpeg' as const};
  const preview=storageReady
   ?await (originalReady?serverPhotoStorage().putOriginal(fullPhoto.bytes,fullPhoto.mimeType):serverPhotoStorage().put(fullPhoto.bytes))
   :{sha256:hashBytes(fullPhoto.bytes),mimeType:fullPhoto.mimeType,base64:fullPhoto.bytes.toString('base64')};
  const envelope=storageReady
   ?{photoWithStoredPreview:{thumbnail:photo,preview,insertOnly}}
   :{photoWithPreview:{thumbnail:photo,preview,insertOnly}};
  const {data,error}=await client.rpc('monitoring_ingest',{p_data:envelope});
  if(error)throw error;
  if(!data||typeof data!=='object'||Array.isArray(data)||data.previewStored!==true||(storageReady&&data.previewStorage!==true))throw new Error('PHOTO_PREVIEW_UNCONFIRMED');
  if(parsed.data.insertOnly){
   const confirmed=insertOnlyResult.safeParse(data);
   if(!confirmed.success||confirmed.data.sha256!==storedHash)throw new Error('PHOTO_INSERT_ONLY_UNCONFIRMED');
   return Response.json({accepted:true,insertOnly:true,status:confirmed.data.status,sha256:confirmed.data.sha256},{headers:{'Cache-Control':'no-store'}});
  }
  return Response.json({accepted:true},{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  if(error instanceof InvalidPhotoError)return Response.json({error:'Foto inválida.',code:error.code},{status:400,headers:{'Cache-Control':'no-store'}});
  if(parsed.data.insertOnly&&typeof error==='object'&&error!==null&&'message' in error&&error.message==='PHOTO_ALREADY_EXISTS')return Response.json({error:'Já existe outra foto para esta identidade.',code:'PHOTO_ALREADY_EXISTS',insertOnly:true},{status:409,headers:{'Cache-Control':'no-store'}});
  return monitoringFailure(error);
 }
}
