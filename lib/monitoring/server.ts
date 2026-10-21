import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Json,MonitoringDatabase } from "./database";
import { snapshotSchema,type MonitoringFilters } from "./contracts";
import { monitoringErrorCode, monitoringErrorMessage } from "./errors";
import { monitoringQueryView, readCompleteMonitoring } from "./query-view";

const businessErrors:Record<string,string>={
 ARCHIVE_MAINTENANCE:'O histórico está em manutenção. Os dados estão preservados; tente novamente após a conclusão.',
 BINDING_STALE:'O vínculo mudou. Atualize a consulta antes de continuar.',
 BINDING_SUPERSEDED:'Use a revisão mais recente deste vínculo.',
 BINDING_INVALID:'Revise o identificador completo, colaborador, fonte e vigência.',
 SOURCE_DISABLED:'A fonte está desativada.',
 SETTING_STALE:'Esta configuração foi alterada. Atualize a consulta antes de continuar.',
 SETTING_SUPERSEDED:'Esta revisão já possui uma sucessora. Edite ou restaure a revisão mais recente.',
 SETTING_VERSION_REQUIRED:'Atualize a consulta para carregar a versão da configuração.',
 SETTING_TARGET_IMMUTABLE:'A edição mantém o tipo e o destino da configuração. Crie outro cadastro para mudar o destino.',
 SETTING_INVALID_INPUT:'Revise os campos da configuração.',
 IDENTITY_VALIDITY_CONFLICT:'Esta identidade já possui vínculo no período. Revise a vigência ou remova o vínculo anterior com justificativa.',
 SETTING_VALIDITY_CONFLICT:'Já existe uma configuração vigente para este cadastro. Revise as datas ou remova a anterior com justificativa.',
 USER_LINK_CONFLICT:'Esta conta já está vinculada a um colaborador no período.',
 USER_LINK_INVALID:'Conta ou colaborador inválido para o vínculo.',
 IMMUTABLE_FILE_CONTRACT_CONFLICT:'O arquivo apresentou contagens diferentes com a mesma versão de parser. Confira a configuração e o parser.',
 INVALID_COVERAGE_INTERVAL:'O fim da cobertura precisa ser posterior ao início.',
 BINDING_NOT_FOUND:'Vínculo já removido. Atualize a consulta.',SETTING_NOT_FOUND:'Configuração já removida. Atualize a consulta.',
};

export async function monitoringQuery(action:string,data:unknown={},signal?:AbortSignal) {
 const client=await createClient<MonitoringDatabase>();
 const query=client.rpc("monitoring_query",{p_action:action,p_data:data as Json});
 const {data:result,error}=await (signal?query.abortSignal(signal):query);
 if(error) throw Object.assign(new Error("MONITORING_QUERY_FAILED"),{code:Object.keys(businessErrors).find(code=>error.message?.includes(code))??error.code});
 return result;
}
export async function loadMonitoringPage(filters:MonitoringFilters,signal?:AbortSignal) { return snapshotSchema.parse(await monitoringQuery("summary",filters,signal)); }
export async function loadMonitoring(filters:MonitoringFilters,signal?:AbortSignal) { return monitoringQueryView(await readCompleteMonitoring(filters,loadMonitoringPage,signal),filters); }
export async function changeMonitoringSetting(action:string,data:unknown) {
 const client=await createClient<MonitoringDatabase>();
 const {data:result,error}=await client.rpc('monitoring_setting_change',{p_action:action,p_data:data as Json});
 if(error) throw Object.assign(new Error('MONITORING_QUERY_FAILED'),{code:Object.keys(businessErrors).find(code=>error.message?.includes(code))??error.code});
 return result;
}
export function workerClient(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.MONITORING_SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key) throw Object.assign(new Error("MONITORING_SERVER_CREDENTIAL_MISSING"), { code: "MONITORING_SERVER_CREDENTIAL_MISSING" });
 return createSupabaseClient<MonitoringDatabase>(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export function monitoringFailure(error:unknown){
 const correlationId=crypto.randomUUID();
 const code=monitoringErrorCode(error);
 console.error('[monitoring]',{correlationId,code});
 return Response.json({error:businessErrors[code]??monitoringErrorMessage(error),code,correlationId},{status:code==='42501'?403:businessErrors[code]?409:503,headers:{'Cache-Control':'private, no-store'}});
}
export async function monitoringSession(admin=false){
 const client=await createClient();
 const {data,error}=await client.auth.getClaims();
 const userId=error?null:data?.claims?.sub;
 if(typeof userId!=="string") return {response:Response.json({error:"Sessão necessária."},{status:401})} as const;
 const {data:profile}=await client.from('perfis').select('id,status_usuario,papel_usuario').eq('id',userId).single();
 if(!profile||profile.status_usuario!=='APROVADO'||!profile.papel_usuario||(admin&&!['ADMIN','RH'].includes(profile.papel_usuario))) return {response:Response.json({error:"Acesso não autorizado."},{status:403})} as const;
 return {userId,profile} as const;
}
export async function boundedJson(request:Request,maxBytes=262144){
 if(Number(request.headers.get('content-length'))>maxBytes) throw new Error('BODY_TOO_LARGE');
 const reader=request.body?.getReader(); if(!reader) throw new Error('BODY_REQUIRED');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('BODY_TOO_LARGE');}chunks.push(value);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
