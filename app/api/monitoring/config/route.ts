import { z } from "zod";
import { bindingSchema,settingSchema } from "@/lib/monitoring/contracts";
import { boundedJson,monitoringQuery,monitoringFailure,monitoringSession,changeMonitoringSetting } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";
export async function POST(request:Request){
 if(!isTrustedMutationOrigin(request))return Response.json({error:"Origem não autorizada."},{status:403});
 const session=await monitoringSession(true);if(session.response)return session.response;
 const envelope=z.object({action:z.enum(['bind','setting','revoke_binding','revoke_setting','replace_setting','restore_setting']),data:z.unknown()}).strict();
 let raw:unknown;try{raw=await boundedJson(request);}catch{return Response.json({error:"Conteúdo inválido."},{status:400});}
 const parsed=envelope.safeParse(raw);if(!parsed.success)return Response.json({error:"Ação inválida."},{status:400});
 const version=z.object({id:z.string().uuid(),expectedUpdatedAt:z.string().datetime({offset:true}),reason:z.string().trim().min(5).max(1000)}).strict();
 const schema=parsed.data.action==='bind'?bindingSchema:parsed.data.action==='setting'?settingSchema:parsed.data.action==='replace_setting'?version.extend({setting:settingSchema}):version;
 const data=schema.safeParse(parsed.data.data);if(!data.success)return Response.json({error:"Revise os campos e a vigência.",fields:data.error.flatten()},{status:400});
 try{return Response.json(await (['replace_setting','restore_setting','revoke_setting'].includes(parsed.data.action)?changeMonitoringSetting(parsed.data.action.replace('_setting',''),data.data):monitoringQuery(parsed.data.action,data.data)),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return monitoringFailure(error);}
}
