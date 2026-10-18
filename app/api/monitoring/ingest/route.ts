import { z } from 'zod';
import { allowedIngestSource,validWorkerToken } from '@/lib/monitoring/ingest-security';
import { boundedJson,monitoringFailure,workerClient } from '@/lib/monitoring/server';
import type { Json } from '@/lib/monitoring/database';
import { normalizeIdentifier } from '@/lib/monitoring/ingestion/validation';
import { httpBodyLimitBytes } from '@/lib/monitoring/payload-limits';
const id=z.string().min(1).max(100);
const hash=z.string().regex(/^[0-9a-f]{64}$/);
const event=z.object({key:z.string().min(1).max(300),type:z.enum(['punch','access']),identity:z.object({type:z.enum(['cpf','pis','defense']),value:id}).nullable(),timestamp:z.string().datetime({offset:true}),device:z.string().max(300),classification:z.enum(['authorized','denied','alarm','anonymous','unknown']),eligible:z.boolean(),nsr:z.string().regex(/^\d{9}$/).optional(),precisionSeconds:z.number().positive(),original:z.record(z.string())}).passthrough().superRefine((value,ctx)=>{
 if(value.type==='punch'&&(!value.nsr||!value.identity||value.identity.type==='defense'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Batida exige NSR e CPF/PIS'});
 if(value.identity){try{normalizeIdentifier(value.identity.value,value.identity.type);}catch{ctx.addIssue({code:z.ZodIssueCode.custom,message:'Identificador inválido'});}}
 if(value.eligible&&(!value.identity||value.classification!=='authorized'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Evento não elegível'});
});
const batch=z.object({protocolVersion:z.literal(1),source:z.object({id,kind:z.enum(['afd','defense-access','defense-person']),timeZone:z.string().min(1).max(100),identityNamespace:id.optional()}).passthrough(),file:z.object({sha256:hash,byteLength:z.number().int().positive().max(100_000_000),parserVersion:id,relativePath:z.string().min(1).max(1000)}).passthrough(),batch:z.object({index:z.number().int().min(0),final:z.boolean(),totalRows:z.number().int().min(0),occurrenceCount:z.number().int().min(0),totalBatches:z.number().int().min(1)}),occurrences:z.array(z.object({key:z.string().min(1).max(300),line:z.number().int().positive(),sheet:z.string().max(200).optional(),payloadHash:hash,event:event.optional(),person:z.object({externalId:id,name:z.string().min(1).max(300),groups:z.array(z.string().max(200)),photoReference:z.string().max(1000).nullable()}).passthrough().optional(),issues:z.array(z.unknown()),original:z.record(z.string())}).passthrough()).max(500)});
const heartbeat=z.object({protocolVersion:z.literal(1),heartbeat:z.object({sourceId:id,state:z.enum(['scanning','idle','error']),code:z.string().max(100).optional(),source:z.object({id,kind:z.enum(['afd','defense-access','defense-person']),timeZone:id,identityNamespace:id.optional()}).passthrough().optional()})});
const failure=z.object({protocolVersion:z.literal(1),failure:z.object({sourceId:id,relativePath:z.string().min(1).max(1000),code:z.string().regex(/^[A-Z0-9_]+$/).max(100)})});
export async function POST(request:Request){
 if(!validWorkerToken(request.headers.get('authorization'),process.env.MONITORING_INGEST_TOKEN))return Response.json({error:'Credencial de ingestão inválida.'},{status:401});
 let raw:unknown;try{raw=await boundedJson(request,httpBodyLimitBytes);}catch{return Response.json({error:'Lote inválido ou acima do limite de 4.400.000 bytes.'},{status:400});}
 const parsed=z.union([heartbeat,failure,batch]).safeParse(raw);if(!parsed.success)return Response.json({error:'Contrato de ingestão inválido.'},{status:400});
 const sourceId='heartbeat' in parsed.data?parsed.data.heartbeat.sourceId:'failure' in parsed.data?parsed.data.failure.sourceId:parsed.data.source.id;
 if(!allowedIngestSource(sourceId))return Response.json({error:'Fonte não autorizada para este worker.'},{status:403});
 try{const {data,error}=await workerClient().rpc('monitoring_ingest',{p_data:parsed.data as Json});if(error)throw error;return Response.json({...(typeof data==='object'&&data?data:{}),accepted:true},{headers:{'Cache-Control':'no-store'}});}catch(error){return monitoringFailure(error);}
}
