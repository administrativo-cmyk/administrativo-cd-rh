"use client";
import { useState } from "react";
import type { DefenseConfirmationPreview } from "@/lib/monitoring/defense-confirmation";
import type { AdminSnapshot } from "./admin-types";
import { buttonClass, Field, inputClass, primaryClass, requestJson } from "./shared";

const labels={create:"Criar evidência",extend:"Ampliar vigência",covered:"Já confirmado",conflict:"Conferir conflito",unlinked:"Sem vínculo no intervalo"};
export function DefenseConfirmationPanel({sources,today,onChanged}:{sources:AdminSnapshot["sources"];today:string;onChanged:()=>void}){
  const [values,setValues]=useState({start:today,end:today,personSourceId:sources.find(s=>s.kind==="defense-person"&&s.active!==false)?.id??"",accessSourceId:sources.find(s=>s.kind==="defense-access"&&s.active!==false)?.id??"",confirmCoverage:false,confirmGroups:false,reason:""});
  const [preview,setPreview]=useState<DefenseConfirmationPreview|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  function change<K extends keyof typeof values>(key:K,value:typeof values[K]){setValues(old=>({...old,[key]:value}));setPreview(null);setError("");setNotice("");}
  async function prepare(){setBusy(true);setError("");setNotice("");try{setPreview(await requestJson<DefenseConfirmationPreview>("/api/monitoring/defense-confirmation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...values,action:"preview"})}));}catch(e){setError(e instanceof Error?e.message:"Falha na prévia.");}finally{setBusy(false);}}
  async function apply(){if(!preview||busy)return;setBusy(true);setError("");let cursor=0,applied=0;
    try{for(let turn=0;turn<=Math.ceil(preview.total/20);turn++){
      const result=await requestJson<{cursor:number;done:boolean;applied:number;counts:DefenseConfirmationPreview["counts"]}>("/api/monitoring/defense-confirmation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...values,action:"apply",fingerprint:preview.fingerprint,cursor})});
      applied+=result.applied;setNotice(`${result.cursor} de ${preview.total} cadastros conferidos · ${applied} alteração(ões) salva(s).`);
      if(result.done){setNotice(`Confirmação concluída: ${applied} alteração(ões) salva(s). ${result.counts.conflict} conflito(s) e ${result.counts.unlinked} cadastro(s) sem vínculo exigem conferência. Jornadas afetadas entram no recálculo automático.`);onChanged();return;}
      if(result.cursor<=cursor)throw new Error("A confirmação não avançou. Gere nova prévia para continuar.");cursor=result.cursor;
    }throw new Error("Gere nova prévia para continuar a confirmação.");
    }catch(e){setError(`${e instanceof Error?e.message:"Falha ao confirmar."} As evidências já salvas são preservadas; gere nova prévia para continuar.`);onChanged();}finally{setBusy(false);}
  }
  return <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer font-semibold">Confirmar período do Defense</summary>
    <p className="mt-2 text-sm text-slate-600">Confirme somente dias completos e grupos que já valiam no intervalo. A prévia usa os cadastros importados e os vínculos existentes. Datas fora da vigência e registros originais são preservados.</p>
    <form aria-label="Confirmação histórica do Defense" className="mt-4 space-y-3" onSubmit={event=>{event.preventDefault();void prepare();}}><fieldset disabled={busy} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2">
      <Field label="Defense — início"><input type="date" required className={inputClass} value={values.start} onChange={e=>change("start",e.target.value)}/></Field><Field label="Defense — fim"><input type="date" required className={inputClass} value={values.end} onChange={e=>change("end",e.target.value)}/></Field>
      <Field label="Fonte dos acessos Defense"><select required className={inputClass} value={values.accessSourceId} onChange={e=>change("accessSourceId",e.target.value)}><option value="">Selecione</option>{sources.filter(s=>s.kind==="defense-access"&&s.active!==false).map(s=><option key={s.id} value={s.id}>{s.label??s.id}</option>)}</select></Field>
      <Field label="Fonte dos cadastros Defense"><select required className={inputClass} value={values.personSourceId} onChange={e=>change("personSourceId",e.target.value)}><option value="">Selecione</option>{sources.filter(s=>s.kind==="defense-person"&&s.active!==false).map(s=><option key={s.id} value={s.id}>{s.label??s.id}</option>)}</select></Field>
    </div>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={values.confirmCoverage} onChange={e=>change("confirmCoverage",e.target.checked)}/>Confirmo todas as passagens de entrada e saída do torniquete e refeitório nos dias informados</label>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={values.confirmGroups} onChange={e=>change("confirmGroups",e.target.checked)}/>Confirmo que os grupos do cadastro importado já valiam durante todo o intervalo</label>
    <Field label="Evidência da confirmação Defense"><textarea required minLength={5} maxLength={1000} rows={3} className={inputClass} value={values.reason} onChange={e=>change("reason",e.target.value)}/></Field>
    <button className={buttonClass} disabled={busy||(!values.confirmCoverage&&!values.confirmGroups)}>Gerar prévia Defense</button></fieldset></form>
    {preview?<div className="mt-4 space-y-3 text-sm"><p>Arquivo de cadastros: <b>{preview.sourceFile}</b></p><p>{preview.counts.create} para criar · {preview.counts.extend} para ampliar · {preview.counts.covered} já confirmado(s) · {preview.counts.conflict} conflito(s) · {preview.counts.unlinked} sem vínculo.</p>
      <ul className="text-xs">{preview.coverage.map(item=><li key={item.label}>{item.label==="operation"?"Torniquete":"Refeitório"}: {labels[item.status]}{item.why?` · ${item.why}`:""}</li>)}</ul>
      <details><summary className="cursor-pointer text-blue-900">Conferir {preview.people.length} cadastro(s)</summary><div className="mt-2 max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Colaborador</th><th className="p-2">Grupos</th><th className="p-2">Resultado</th></tr></thead><tbody>{preview.people.map((p,i)=><tr key={`${p.employeeNumber}:${i}`} className="border-t border-slate-100"><td className="p-2">{p.employeeNumber} · {p.name}</td><td className="p-2">{p.groups.join(", ")}</td><td className="p-2">{labels[p.status]}{p.why?` · ${p.why}`:""}</td></tr>)}</tbody></table></div></details>
      <button type="button" className={primaryClass} disabled={busy} onClick={()=>void apply()}>{busy?"Confirmando…":"Aplicar confirmação Defense"}</button></div>:null}
    {notice?<p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>:null}{error?<p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{error}</p>:null}
  </details>;
}
