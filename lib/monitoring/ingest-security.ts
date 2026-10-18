import { timingSafeEqual,createHash } from 'node:crypto';
export function validWorkerToken(header:string|null,expected:string|undefined){
 if(!expected||expected.length<32||!header?.startsWith('Bearer '))return false;
 const supplied=Buffer.from(header.slice(7));const secret=Buffer.from(expected);
 return supplied.length===secret.length && timingSafeEqual(supplied,secret);
}
export function allowedIngestSource(id:string,allowlist=process.env.MONITORING_INGEST_SOURCE_IDS){return !!allowlist?.split(',').map(x=>x.trim()).filter(Boolean).includes(id);}
export function hashBytes(bytes:Uint8Array){return createHash('sha256').update(bytes).digest('hex');}
