import { defenseConfirmationSchema, planDefenseConfirmation, readDefenseConfirmationAdmin, applyDefenseConfirmation } from "@/lib/monitoring/defense-confirmation";
import { boundedJson, monitoringSession, monitoringQuery, changeMonitoringSetting, monitoringFailure } from "@/lib/monitoring/server";
import { isTrustedMutationOrigin } from "@/lib/security/mutation-origin";

export async function POST(request:Request){
  if(!isTrustedMutationOrigin(request))return Response.json({error:"Origem não autorizada."},{status:403});
  const session=await monitoringSession(true);if(session.response)return session.response;
  let raw:unknown;try{raw=await boundedJson(request,8192);}catch{return Response.json({error:"Conteúdo inválido."},{status:400});}
  const parsed=defenseConfirmationSchema.safeParse(raw);if(!parsed.success)return Response.json({error:"Informe fontes, intervalo de até 31 dias e confirmação das evidências."},{status:400});
  try{
    const admin=await readDefenseConfirmationAdmin(offset=>monitoringQuery("admin",{offset}));
    const plan=planDefenseConfirmation(admin,parsed.data);
    if(parsed.data.action==="preview")return Response.json(plan.preview,{headers:{"Cache-Control":"private, no-store"}});
    const result=await applyDefenseConfirmation(plan,parsed.data,change=>change.previous?
      changeMonitoringSetting("replace",{id:change.previous.id,expectedUpdatedAt:change.previous.updated_at,reason:parsed.data.reason,setting:change.setting}):monitoringQuery("setting",change.setting));
    return Response.json(result,{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    if(error&&typeof error==="object"&&"code"in error&&String(error.code).startsWith("DEFENSE_"))return Response.json({error:"A prévia mudou ou há conflito nas fontes/evidências. Atualize a prévia e confira os cadastros.",code:error.code},{status:409,headers:{"Cache-Control":"private, no-store"}});
    return monitoringFailure(error);
  }
}
