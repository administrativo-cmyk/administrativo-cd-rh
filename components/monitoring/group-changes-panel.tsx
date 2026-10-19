"use client";
import { useEffect,useState } from "react";
import { groupChangesSchema,type GroupChanges } from "@/lib/monitoring/group-changes";
import { buttonClass,inputClass,instant,requestJson } from "./shared";

const statuses={pending:"Conferir data da mudança",confirmed:"Grupos já confirmados",conflict:"Conflito: conferir evidências",unlinked:"Sem vínculo na data observada"};
const groups=(values:string[])=>values.join(", ")||"Sem grupos";
export function GroupChangesPanel({refreshKey=0}:{refreshKey?:number}){
 const [result,setResult]=useState<{key:string;data:GroupChanges|null;error:string}|null>(null);
 const [draft,setDraft]=useState(""),[query,setQuery]=useState(""),[includeConfirmed,setIncludeConfirmed]=useState(false),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0);
 const url=`/api/monitoring/group-changes?${new URLSearchParams({query,includeConfirmed:String(includeConfirmed),offset:String(offset),limit:"50"})}`;
 const requestKey=`${url}|${revision}|${refreshKey}`,loading=result?.key!==requestKey,data=result?.data??null,error=result?.key===requestKey?result.error:"";
 useEffect(()=>{const abort=new AbortController();
  requestJson(url,{signal:abort.signal})
   .then(value=>{if(!abort.signal.aborted)setResult({key:requestKey,data:groupChangesSchema.parse(value),error:""});})
   .catch(e=>{if(!abort.signal.aborted)setResult(previous=>({key:requestKey,data:previous?.data??null,error:e instanceof Error?e.message:"Falha ao comparar os grupos."}));});return()=>abort.abort();
 },[requestKey,url]);
 return <section id="mudancas-grupos" aria-label="Mudanças de grupos Defense" aria-busy={loading} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Mudanças de grupos detectadas</h3><button type="button" className={buttonClass} disabled={loading} onClick={()=>setRevision(v=>v+1)}>Atualizar grupos</button></div>
  <p className="max-w-4xl text-sm text-slate-600">Cada arquivo Defense concluído é comparado automaticamente com os anteriores. Reenvios e mudanças na ordem dos grupos não geram novas trocas. A data abaixo é a observação no arquivo; confirme a data real em “Grupos com vigência” antes de alterar o histórico.</p>
  <form aria-label="Filtrar mudanças de grupos" className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();setOffset(0);setQuery(draft);}}>
   <label className="min-w-52 flex-1 text-xs">Nome ou matrícula<input className={inputClass} value={draft} onChange={e=>setDraft(e.target.value)}/></label>
   <button className={buttonClass} disabled={loading}>Buscar mudanças</button>
   <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={includeConfirmed} onChange={e=>{setIncludeConfirmed(e.target.checked);setOffset(0);}}/>Mostrar grupos já confirmados</label>
  </form>
  {loading?<p role="status" className="text-sm text-slate-600">Comparando arquivos Defense…</p>:null}
  {error?<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{error} Os dados anteriores podem estar desatualizados.</p>:null}
  {data?<><p className="text-xs text-slate-600">{data.pending} alteração(ões) para conferir · {data.checkedFiles} arquivo(s) concluído(s) comparado(s). Última consulta: {instant(data.checkedAt)}.</p>
   {data.rows.length?<div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr>{["Colaborador","Grupo anterior","Grupo observado","Arquivo e observação","Situação"].map(h=><th scope="col" className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{data.rows.map(row=><tr className="border-t border-slate-100 align-top" key={row.key}>
    <th scope="row" className="p-3 text-left"><b className="block">{row.name}</b><span className="font-normal text-slate-500">{row.employee_number} · ID Defense {row.external_id}</span></th>
    <td className="max-w-72 break-words p-3">{groups(row.old_groups)}<span className="mt-2 block text-slate-500">{row.previous_file}</span></td>
    <td className="max-w-72 break-words p-3">{row.variants.map((variant,i)=><p key={i}>{groups(variant)}</p>)}</td>
    <td className="max-w-64 break-words p-3">{row.file_name}<span className="mt-2 block text-slate-500">{row.time_origin==="filename"?"Data no nome do arquivo":"Recebimento"}: {instant(row.observed_at)}</span></td>
    <td className="p-3"><span className={`inline-block rounded-md px-2 py-1 ${row.status==="confirmed"?"bg-emerald-50 text-emerald-900":"bg-amber-50 text-amber-900"}`}>{statuses[row.status]}</span></td>
   </tr>)}</tbody></table></div>:!loading?<p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Nenhuma mudança de grupo encontrada nos filtros.</p>:null}
   <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600"><span>{data.total?offset+1:0}–{Math.min(offset+50,data.total)} de {data.total} mudanças</span><div className="flex gap-2"><button type="button" className={buttonClass} disabled={loading||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-50))}>Mudanças anteriores</button><button type="button" className={buttonClass} disabled={loading||offset+50>=data.total} onClick={()=>setOffset(v=>v+50)}>Próximas mudanças</button></div></div>
  </>:null}
 </section>;
}
