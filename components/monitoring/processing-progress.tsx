"use client";
import { useEffect,useRef,useState } from "react";
import { CheckCircle2,Clock3,TriangleAlert } from "lucide-react";
import type { MonitoringFilters } from "@/lib/monitoring/contracts";
import { processingPercentage,processingProgressSchema,type ProcessingProgress } from "@/lib/monitoring/processing-progress";
import { calendarDate,instant,requestJson } from "./shared";

export function MonitoringProcessingProgress({filters,snapshotVersion,onRefresh}:{filters:MonitoringFilters;snapshotVersion?:string;onRefresh:()=>void}){
 const [loaded,setLoaded]=useState<{scope:string;progress:ProcessingProgress}|null>(null);
 const [failedScope,setFailedScope]=useState("");
 const refresh=useRef(onRefresh);const shownVersion=useRef(snapshotVersion);const notifiedVersion=useRef("");const lastRefresh=useRef(0);
 useEffect(()=>{refresh.current=onRefresh;shownVersion.current=snapshotVersion;},[onRefresh,snapshotVersion]);
 const search=new URLSearchParams({start:filters.start,end:filters.end,employeeId:filters.employeeId,unit:filters.unit,managerId:filters.managerId,query:filters.query}).toString();
 const error=failedScope===search;
 const progress=!error&&loaded?.scope===search?loaded.progress:null;
 useEffect(()=>{
  let disposed=false;let timer:ReturnType<typeof setTimeout>;let controller:AbortController|null=null;
  async function poll(){
   if(disposed)return;
   if(document.visibilityState==="hidden"){timer=setTimeout(poll,10000);return;}
   controller=new AbortController();
   try{
    const next=processingProgressSchema.parse(await requestJson(`/api/monitoring/progress?${search}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}));
    if(disposed)return;setLoaded({scope:search,progress:next});setFailedScope("");
    if(shownVersion.current&&shownVersion.current!==next.datasetVersion&&notifiedVersion.current!==next.datasetVersion
     &&(!next.pending&&!next.activeImports||Date.now()-lastRefresh.current>=60000)){
     notifiedVersion.current=next.datasetVersion;lastRefresh.current=Date.now();refresh.current();
    }
    timer=setTimeout(poll,next.pending||next.activeImports?10000:30000);
   }catch{if(!disposed){setFailedScope(search);timer=setTimeout(poll,15000);}}
  }
  void poll();
  return()=>{disposed=true;clearTimeout(timer);controller?.abort();};
 },[search]);
 const percent=progress?processingPercentage(progress):null;
 const waiting=!!progress?.activeImports;
 const busy=waiting||!!progress?.pending;
 const current=!!progress&&!busy&&!progress.failed;
 const syncing=current&&snapshotVersion&&snapshotVersion!==progress.datasetVersion;
 const title=error?"Não foi possível conferir a atualização":!progress?"Conferindo atualização dos indicadores…":waiting?"Importando arquivos · recálculos aguardam a conclusão":progress.failed?"Recálculos precisam de atenção":busy?"Atualizando indicadores":syncing?"Recálculos concluídos · atualizando consulta":progress.total?(progress.limited||progress.withoutData?"Recálculos concluídos · há dados a conferir":"Indicadores atualizados"):"Sem apurações disponíveis no período";
 const Icon=error||progress?.failed?TriangleAlert:current&&progress.total?CheckCircle2:Clock3;
 return <section aria-label="Atualização dos indicadores" className="rounded-xl border border-slate-200 bg-white p-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="flex min-w-0 items-start gap-3"><Icon aria-hidden size={20} className={current&&progress?.total?"mt-0.5 shrink-0 text-emerald-700":"mt-0.5 shrink-0 text-blue-700"}/>
    <div><h2 className="text-sm font-semibold text-slate-950" role="status" aria-live="polite">{title}</h2>
     <p className="mt-1 text-xs text-slate-600">{calendarDate(filters.start)} a {calendarDate(filters.end)} · escopo de colaboradores selecionado, todas as qualidades.</p></div>
   </div>
   {progress&&percent!==null?<strong className="text-xl tabular-nums text-slate-950">{percent.toLocaleString("pt-BR")}%<span className="ml-2 text-xs font-normal text-slate-600">recalculado</span></strong>:null}
  </div>
  {progress?<><progress aria-label="Progresso dos recálculos" max={progress.total||1} value={progress.total?progress.completed:undefined} className="mt-3 h-2 w-full accent-blue-700"/>
   <p className="mt-2 text-sm text-slate-700">{progress.completed.toLocaleString("pt-BR")} de {progress.total.toLocaleString("pt-BR")} jornadas recalculadas · {progress.pending.toLocaleString("pt-BR")} na fila{progress.running?` · ${progress.running} em processamento`:""}.</p>
   {progress.deferred>0?<p className="mt-1 text-xs text-slate-600">{progress.deferred} jornadas aguardam a data ou o início do turno; ficam fora do percentual até poderem ser calculadas.</p>:null}
   {progress.limited>0||progress.withoutData>0?<p className="mt-1 text-xs text-slate-600">{progress.limited} apurações com dados parciais ou insuficientes · {progress.withoutData} colaboradores sem apuração disponível. Concluir o recálculo não preenche batidas ou escalas ausentes.</p>:null}
   {progress.failed>0?<p className="mt-1 text-sm text-rose-800">{progress.failed} jornadas com falha aguardam nova tentativa.</p>:null}
   {progress.imports.length?<details className="mt-3 border-t border-slate-200 pt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-blue-800">Últimas 3 importações</summary><ul className="mt-3 space-y-3">{progress.imports.map(file=>{
    const imported=file.status==="completed";const filePercent=imported?100:file.totalRows?Math.min(99,Math.floor(100*file.processedRows/file.totalRows)):null;
    return <li key={file.id} className="min-w-0 text-xs"><div className="flex flex-wrap justify-between gap-2"><span className="break-all text-slate-800">{file.fileName}</span><strong>{imported?"Arquivo importado · 100%":file.status==="failed"?"Falha na importação":file.status==="cancelled"?"Importação cancelada":filePercent===null?"Preparando importação":`${filePercent}% importado`}</strong></div><p className="mt-1 text-slate-600">{file.processedRows.toLocaleString("pt-BR")}{file.totalRows!==null?` de ${file.totalRows.toLocaleString("pt-BR")}`:""} linhas. {imported?"O estado dos indicadores está no progresso de recálculo acima.":""}</p></li>;
   })}</ul></details>:null}
   <p className="mt-3 text-xs text-slate-500">Conferido em {instant(progress.checkedAt)}. Atualização automática enquanto esta tela estiver visível.</p>
  </>:<p className="mt-2 text-xs text-slate-600">{error?"Nova verificação automática em instantes. O último estado não confirma que os dados estejam atualizados.":"Consultando importações e fila de recálculo."}</p>}
 </section>;
}
