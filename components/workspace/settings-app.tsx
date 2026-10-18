"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import type { WorkspaceSettings } from "@/lib/workspace/contracts";
import { defaultDashboards } from "@/lib/workspace/contracts";
import { applyWorkspacePreferences, workspaceRequest } from "@/lib/workspace/client";
export const workspaceControl = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
export const workspaceButton = "inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50";
const dashboardNames = { index: "Todos os dashboards", monitoramento: "Monitoramento", "chamada-diaria": "Chamada Diária", "banco-de-horas": "Banco de Horas", "quadro-atual": "Quadro Atual" };
export function SettingsApp({ profile }: { profile: AuthenticatedProfile }) {
 const router = useRouter();
 const [settings,setSettings] = useState<WorkspaceSettings | null>(null);
 const [draft,setDraft] = useState<WorkspaceSettings | null>(null);
 const [name,setName] = useState(profile.nome_completo);
 const [error,setError] = useState(""); const [message,setMessage] = useState("");
 const [busy,setBusy] = useState(false); const [refresh,setRefresh] = useState(0);
 useEffect(()=>{
  const abort = new AbortController();
  workspaceRequest<WorkspaceSettings>("settings",{},abort.signal).then(value=>{if(!abort.signal.aborted){setSettings(value);setDraft(value);setName(value.profileName);setError("");}}).catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:"Falha ao consultar configurações.");});
  return ()=>abort.abort();
 },[refresh]);
 async function save(event:FormEvent,action:"save_preferences"|"save_profile"|"reset_preferences") {
  event.preventDefault(); if(!settings||!draft||busy)return;
  setBusy(true);setError("");setMessage("");
  try {
   if(action==="save_profile") {
    const result = await workspaceRequest<Pick<WorkspaceSettings,"profileName"|"profileUpdatedAt">>(action,{name,expectedUpdatedAt:settings.profileUpdatedAt});
    setSettings({...settings,...result}); setName(result.profileName); router.refresh();
   } else {
    const result=await workspaceRequest<WorkspaceSettings>(action,action==="reset_preferences"?{expectedUpdatedAt:settings.updatedAt}:{defaultDashboard:draft.defaultDashboard,compactTables:draft.compactTables,notificationsEnabled:draft.notificationsEnabled,expectedUpdatedAt:settings.updatedAt});
    setSettings(result);setDraft(result);applyWorkspacePreferences(result);
   }
   setMessage(action==="reset_preferences"?"Preferências restauradas.":"Alterações salvas.");
  } catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível salvar.");} finally {setBusy(false);}
 }
 return <AppShell profile={profile} title="Configurações" activeLabel="Configurações"><div className="mx-auto max-w-4xl space-y-5">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Configurações</h1><p className="mt-1 text-sm text-slate-600">Perfil, preferências pessoais e configurações da operação.</p></div><button className={workspaceButton} disabled={busy} onClick={()=>{setMessage("");setRefresh(value=>value+1);}}>Atualizar consulta</button></header>
  {error?<p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}{settings?" Seus campos permanecem disponíveis para revisão.":""}</p>:null}
  {message?<p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>:null}
  {!settings&&!error?<p role="status">Carregando configurações…</p>:null}
  <form id="perfil" onSubmit={event=>void save(event,"save_profile")} className="scroll-mt-20 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
   <h2 className="text-lg font-semibold">Meu perfil</h2><p className="text-sm text-slate-600">Papel atual: {profile.papel_usuario}. Permissões são administradas na área Usuários.</p>
   <label className="block space-y-1 text-sm font-medium">Nome completo<input className={workspaceControl} value={name} onChange={event=>setName(event.target.value)} minLength={3} maxLength={200} required disabled={!settings||busy}/></label>
   <button type="submit" className={workspaceButton} disabled={!settings||busy}>Salvar nome</button>
  </form>
  <form id="preferencias" onSubmit={event=>void save(event,"save_preferences")} className="scroll-mt-20 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
   <h2 className="text-lg font-semibold">Preferências</h2>
   <label className="block space-y-1 text-sm font-medium">Página inicial<select className={workspaceControl} value={draft?.defaultDashboard??"index"} disabled={!settings||busy} onChange={event=>draft&&setDraft({...draft,defaultDashboard:event.target.value as WorkspaceSettings["defaultDashboard"]})}>{defaultDashboards.map(value=><option key={value} value={value}>{dashboardNames[value]}</option>)}</select></label>
   <p className="text-xs text-slate-600">Aplicada ao entrar no sistema ou acessar o endereço inicial.</p>
   <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft?.compactTables??false} disabled={!settings||busy} onChange={event=>draft&&setDraft({...draft,compactTables:event.target.checked})}/>Tabelas compactas</label>
   <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft?.notificationsEnabled??true} disabled={!settings||busy} onChange={event=>draft&&setDraft({...draft,notificationsEnabled:event.target.checked})}/>Mostrar contagem de notificações no cabeçalho</label>
   <p className="text-xs text-slate-600">A caixa de notificações continua disponível pelo sino.</p>
   <div className="flex flex-wrap gap-2"><button type="submit" className={workspaceButton} disabled={!settings||busy}>Salvar preferências</button><button type="button" className={workspaceButton} disabled={!settings||busy} onClick={event=>void save(event,"reset_preferences")}>Restaurar padrão</button></div>
  </form>
  {profile.papel_usuario==="ADMIN"||profile.papel_usuario==="RH"?<section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-semibold">Operação</h2><div className="flex flex-wrap gap-2"><Link href="/monitoramento?tab=configuracao" className={workspaceButton}>Configurar Monitoramento</Link><Link href="/administracao" className={workspaceButton}>Cadastros</Link><Link href="/usuarios" className={workspaceButton}>Usuários e permissões</Link><Link href="/notificacoes?view=notices" className={workspaceButton}>Administrar avisos</Link></div></section>:null}
 </div></AppShell>;
}
