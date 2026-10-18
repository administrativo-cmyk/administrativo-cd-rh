import { filtersSchema,type MonitoringRow } from "@/lib/monitoring/contracts";
import { monitoringCsv } from "@/lib/monitoring/export";
import { loadMonitoring,monitoringFailure,monitoringSession } from "@/lib/monitoring/server";
export async function GET(request:Request){
 const session=await monitoringSession();if(session.response)return session.response;
 const parsed=filtersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!parsed.success)return Response.json({error:"Filtros inválidos."},{status:400});
 try{
  const rows:MonitoringRow[]=[];let total=0;let version:string|undefined;
  do{const page=await loadMonitoring({...parsed.data,offset:rows.length,limit:500});
   if(version!==undefined&&version!==page.datasetVersion)return Response.json({error:'Dados mudaram durante a exportação. Atualize a consulta e tente novamente.'},{status:409});
   version=page.datasetVersion;total=page.total;rows.push(...page.rows);if(!page.rows.length)break;if(total>20000)return Response.json({error:'Reduza o período para exportar até 20.000 jornadas.'},{status:422});}while(rows.length<total);
  return new Response(monitoringCsv(rows,{periodo:`${parsed.data.start} a ${parsed.data.end}`,filtros:JSON.stringify(parsed.data),geradoEm:new Date().toISOString(),observacao:'Valores parciais são conhecidos apenas na cobertura declarada. Indicadores de áreas diferentes podem se sobrepor.'}),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="monitoramento.csv"','Cache-Control':'private, no-store'}});
 }catch(error){return monitoringFailure(error);}
}
