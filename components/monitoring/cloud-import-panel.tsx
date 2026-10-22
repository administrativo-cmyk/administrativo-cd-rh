"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ImportFreshnessSummary } from "./import-freshness";
import { dashboardButton as button, dashboardInput as input, dashboardInstant } from "@/components/dashboards/format";
import { cloudActionSchema, cloudError, cloudFileHash, cloudFileLimit, cloudRequest, cloudReservationSchema, cloudSnapshotSchema, cloudStatusLabels, uploadCloudFile, validateCloudFile, type CloudJob, type CloudPhase, type CloudSnapshot } from "./cloud-import-client";

const phaseLabels: Record<CloudPhase, string> = { idle: "", hashing: "1 de 3: conferindo o arquivo…", authorizing: "1 de 3: preparando o envio…", uploading: "2 de 3: enviando o arquivo… Mantenha esta página aberta.", confirming: "3 de 3: confirmando o recebimento…" };
const pending = (job: CloudJob) => ["uploading", "queued", "processing"].includes(job.status);
const bytesLabel = (bytes: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(bytes / 1024 / 1024)} MiB`;

export function CloudImportPanel({ onCompleted, refreshVersion = 0 }: { onCompleted?: () => void; refreshVersion?: number }) {
  const [snapshot, setSnapshot] = useState<CloudSnapshot | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [readError, setReadError] = useState(""); const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<CloudPhase>("idle"); const [activeAction, setActiveAction] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null); const [cancelId, setCancelId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all"); const [page, setPage] = useState(0);
  const readAbort = useRef<AbortController | null>(null); const writeAbort = useRef<AbortController | null>(null);
  const mounted = useRef(false); const seenJobs = useRef<Map<string, string>>(new Map());
  const errorRef = useRef<HTMLParagraphElement>(null); const fileRef = useRef<HTMLInputElement>(null);
  const busy = phase !== "idle" || activeAction !== null;
  const hasPending = snapshot?.jobs.some(pending) ?? false;

  const refresh = useCallback(async () => {
    readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller;
    try {
      const result = await cloudRequest("/api/monitoring/cloud", cloudSnapshotSchema, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      const completed = result.jobs.some(job => job.status === "completed" && seenJobs.current.has(job.id) && seenJobs.current.get(job.id) !== "completed");
      seenJobs.current = new Map(result.jobs.map(job => [job.id, job.status]));
      setSnapshot(result); setReadError(""); if (completed) onCompleted?.();
    } catch (cause) { if (!controller.signal.aborted && mounted.current) setReadError(cause instanceof Error ? cause.message : "Não foi possível atualizar o histórico."); }
    finally {
      if (readAbort.current === controller) readAbort.current = null;
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }, [onCompleted]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readAbort.current?.abort(); writeAbort.current?.abort(); };
  }, []);
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => { if (!disposed) void refresh(); });
    return () => { disposed = true; };
  }, [refresh, refreshVersion]);
  useEffect(() => {
    if (!hasPending) return;
    const poll = () => { if (document.visibilityState === "visible" && (!readAbort.current || readAbort.current.signal.aborted)) void refresh(); };
    const visibility = () => { if (document.visibilityState === "hidden") readAbort.current?.abort(); else poll(); };
    const timer = window.setInterval(poll, 10000); document.addEventListener("visibilitychange", visibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [hasPending, refresh]);
  useEffect(() => {
    if (phase === "idle") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  function showError(message: string) { setError(message); requestAnimationFrame(() => errorRef.current?.focus()); }
  function accepted(status: CloudJob["status"], clearDraft: boolean) {
    if (!["queued", "processing", "completed"].includes(status)) throw new Error("O recebimento ainda não foi confirmado. Confira o histórico antes de fechar a página.");
    if (clearDraft) { setConfirmation(null); setFile(null); if (fileRef.current) fileRef.current.value = ""; }
    setNotice(!clearDraft && file ? "Recebimento deste envio confirmado. O arquivo selecionado no formulário foi mantido; esta confirmação se refere ao envio do histórico." : status === "completed" ? "Arquivo recebido e processamento concluído. Você já pode fechar a página ou desligar o computador." : !snapshot?.automationReady ? "Arquivo recebido e confirmado. A automação ainda aguarda ativação no servidor; acompanhe a situação no histórico." : "Arquivo recebido e confirmado. O processamento continua na nuvem; você já pode fechar a página ou desligar o computador.");
    if (status === "completed") onCompleted?.();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || !snapshot) return;
    if (!snapshot.automationReady) { showError(cloudError("CLOUD_AUTOMATION_DISABLED")); return; }
    const validation = validateCloudFile(file, undefined, "auto", snapshot.maxFileBytes);
    if (validation) { showError(validation); return; }
    const selectedFile = file!; const controller = new AbortController(); writeAbort.current = controller;
    setError(""); setNotice(""); setConfirmation(null); setPhase("hashing");
    try {
      const sha256 = await cloudFileHash(selectedFile, controller.signal);
      setPhase("authorizing");
      const reservation = await cloudRequest("/api/monitoring/cloud", cloudReservationSchema, controller.signal, { fileName: selectedFile.name, byteLength: selectedFile.size, sha256 });
      if ("alreadyUploaded" in reservation) {
        accepted(reservation.status, true);
        setNotice(`Este arquivo já foi recebido${reservation.status === "completed" ? " e processado" : " e continua na fila ou em processamento"}. Nenhum novo upload foi necessário. Você pode fechar a página ou desligar o computador.`);
        return;
      }
      setPhase("uploading"); await uploadCloudFile(reservation, selectedFile, controller.signal);
      setConfirmation(reservation.id); setPhase("confirming");
      const result = await cloudRequest(`/api/monitoring/cloud/${encodeURIComponent(reservation.id)}/complete`, cloudActionSchema, controller.signal, {});
      if (result.id !== reservation.id) throw new Error("O servidor não confirmou este arquivo. Atualize o histórico.");
      if (!controller.signal.aborted) accepted(result.status, true);
    } catch (cause) { if (!controller.signal.aborted) showError(cause instanceof Error ? cause.message : "O envio não foi confirmado. Confira sua conexão e tente novamente."); }
    finally { if (!controller.signal.aborted && mounted.current) { setPhase("idle"); void refresh(); } }
  }
  async function action(id: string, name: "complete" | "retry" | "cancel" | "reinspect", updatedAt?: string) {
    if (busy) return;
    const controller = new AbortController(); writeAbort.current = controller; setActiveAction(id); setError(""); setNotice("");
    try {
      const result = await cloudRequest(`/api/monitoring/cloud/${encodeURIComponent(id)}/${name}`, cloudActionSchema, controller.signal, updatedAt ? { expectedUpdatedAt: updatedAt } : {});
      if (controller.signal.aborted) return;
      if (result.id !== id) throw new Error("O servidor não confirmou este arquivo. Atualize o histórico.");
      if (name === "complete") accepted(result.status, confirmation === id);
      else if (name === "cancel") { if (result.status !== "cancelled") throw new Error("O cancelamento não foi confirmado. Atualize o histórico."); setNotice("Processamento cancelado. Registros já importados permanecem preservados."); if (confirmation === id) setConfirmation(null); }
      else { if (!["queued", "processing", "completed"].includes(result.status)) throw new Error("A nova tentativa não foi confirmada. Atualize o histórico."); setNotice(name === "reinspect" ? "Reavaliação enfileirada. O original e a importação anterior são preservados." : "Nova tentativa confirmada. Acompanhe o resultado no histórico."); }
      setCancelId(null);
    } catch (cause) { if (!controller.signal.aborted) showError(cause instanceof Error ? cause.message : "Não foi possível concluir a ação."); }
    finally { if (!controller.signal.aborted && mounted.current) { setActiveAction(null); void refresh(); } }
  }

  const jobs = snapshot?.jobs.filter(job => filter === "all" || job.status === filter) ?? [];
  const pages = Math.max(1, Math.ceil(jobs.length / 10)); const currentPage = Math.min(page, pages - 1);
  return <section aria-labelledby="cloud-import-title" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="cloud-import-title" className="font-semibold text-slate-900">Enviar arquivos para a nuvem</h3><p className="mt-1 max-w-3xl text-sm text-slate-600">Envie a exportação do ponto ou do Defense. Após a confirmação do recebimento, o processamento continua mesmo com o computador desligado. A exportação de novos arquivos continua sendo feita no equipamento ou no Defense.</p></div><button type="button" className={button} disabled={busy || loading} onClick={() => { setError(""); setLoading(true); void refresh(); }}>Atualizar envios</button></div>
    {snapshot ? <ImportFreshnessSummary rows={snapshot.freshness} /> : null}
    {loading && !snapshot ? <p role="status" className="mt-4 text-sm text-slate-600">Carregando fontes e histórico…</p> : null}
    {snapshot && !snapshot.automationReady ? <p id="cloud-activation-help" role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Aguardando ativação da automação no servidor. Novos envios estão desabilitados. O histórico continua disponível; solicite a ativação ao administrador e depois clique em Atualizar envios.</p> : null}
    {snapshot ? <form onSubmit={submit} className="mt-5 space-y-3" aria-label="Envio de arquivo para processamento na nuvem">
      <fieldset disabled={busy || confirmation !== null || !snapshot.automationReady} aria-describedby={!snapshot.automationReady ? "cloud-activation-help" : undefined} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div><label htmlFor="cloud-import-file" className="text-sm font-medium">Arquivo de importação</label><input id="cloud-import-file" ref={fileRef} type="file" accept=".txt,.xlsx" className={input} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); setNotice(""); }} aria-describedby="cloud-file-help" /><p id="cloud-file-help" className="mt-1 text-xs text-slate-600">Um arquivo por envio, até {bytesLabel(Math.min(snapshot.maxFileBytes, cloudFileLimit))}. AFD .txt ou Defense .xlsx.</p></div>
      </fieldset>
      <p className="text-sm text-slate-600">O servidor identifica automaticamente o layout AFD legado ou ISO e o identificador CPF ou PIS e planilhas de acessos ou cadastros Defense pelo conteúdo. Fotos já cadastradas são preservadas.</p>
      <p className="text-xs text-slate-600">Os originais são preservados. Limite acumulado de 500 MiB, sem exclusão automática; ao atingir o limite, solicite revisão ao administrador.</p>
      {!snapshot.sources.length ? <p className="text-sm text-amber-900">Nenhuma fonte ativa disponível. Cadastre ou ative a fonte em Gerenciar fontes antes de enviar.</p> : null}
      <div className="flex flex-wrap items-center gap-3"><button type="submit" className={cn(button, "border-blue-700 bg-blue-700 text-white hover:bg-blue-800 disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-700 disabled:opacity-100 disabled:hover:bg-slate-200")} disabled={busy || confirmation !== null || !snapshot.sources.length || !snapshot.automationReady}>{phase !== "idle" ? "Enviando…" : "Enviar arquivo"}</button>{file ? <span className="min-w-0 break-all text-xs text-slate-600">{file.name} · {bytesLabel(file.size)}</span> : null}</div>
    </form> : null}
    <div role="status" aria-live="polite" aria-atomic="true" className="mt-3 text-sm text-blue-900">{phase !== "idle" ? phaseLabels[phase] : notice}</div>
    {error || readError ? <p ref={errorRef} tabIndex={-1} role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 outline-none focus-visible:ring-2 focus-visible:ring-rose-600">{error || readError}</p> : null}
    {confirmation && phase === "idle" ? <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm text-amber-900">Arquivo enviado; falta confirmar o recebimento. Não é necessário enviar os bytes novamente.</p><button type="button" className={button} disabled={busy} onClick={() => void action(confirmation, "complete")}>Confirmar recebimento</button></div> : null}
    {snapshot ? <div className="mt-5 border-t border-slate-200 pt-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h4 className="font-semibold">Histórico de envios</h4><p className="text-xs text-slate-600">{jobs.length} envio(s) nesta consulta. Envios pendentes são atualizados a cada 10 segundos enquanto esta página estiver visível.</p></div><label className="text-sm">Filtrar situação<select className={input} value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">Todas</option>{Object.entries(cloudStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {jobs.length ? <ul className="mt-3 divide-y divide-slate-200">{jobs.slice(currentPage * 10, currentPage * 10 + 10).map(job => <li key={job.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="break-all text-sm font-semibold">{job.fileName}</p><p className="mt-1 break-words text-xs text-slate-600">{job.autoDetect ? "Identificação automática pendente" : snapshot.sources.find(item => item.id === job.sourceId)?.name ?? job.sourceId} · {bytesLabel(job.bytes)}</p><p className="mt-1 text-xs text-slate-600">Recebido em {dashboardInstant(job.createdAt)} · Atualizado em {dashboardInstant(job.updatedAt)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${job.status === "completed" ? "bg-emerald-50 text-emerald-800" : job.status === "failed" ? "bg-rose-50 text-rose-800" : "bg-slate-100 text-slate-700"}`}>{cloudStatusLabels[job.status]}</span></div>
        <p className="mt-2 text-xs text-slate-600">{job.totalBatches === null ? `${job.batchesDone} lote(s) concluído(s); total ainda não informado.` : `${job.batchesDone} de ${job.totalBatches} lote(s) concluído(s).`}</p>
        {(job.archivedRows??0)>0&&<p className="mt-1 text-xs text-slate-600">{new Intl.NumberFormat("pt-BR").format(job.archivedRows??0)} registro(s) no histórico privado da nuvem. O banco mantém os últimos três meses.</p>}
        {(job.rejectedRows ?? 0) > 0 ? <p className="mt-2 text-sm text-amber-900">{job.rejectedRows} registro(s) rejeitado(s) na leitura anterior. Confira o relatório ou reavalie com o leitor atualizado.</p> : null}
        {job.status === "failed" ? <p className="mt-2 text-sm text-rose-800">{cloudError(job.errorCode)}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">{job.canReinspect ? <button type="button" className={button} disabled={busy} onClick={() => void action(job.id, "reinspect", job.updatedAt)}>Reavaliar {job.fileName}</button> : null}{job.status === "uploading" ? <button type="button" className={button} disabled={busy} onClick={() => void action(job.id, "complete")}>Confirmar envio de {job.fileName}</button> : null}{job.status === "failed" ? <button type="button" className={button} disabled={busy} onClick={() => void action(job.id, "retry", job.updatedAt)}>Tentar novamente {job.fileName}</button> : null}{pending(job) || job.status === "failed" ? <button type="button" className={button} disabled={busy} onClick={() => setCancelId(job.id)}>Cancelar {job.fileName}</button> : null}</div>
        {cancelId === job.id ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm text-amber-900">Cancelar este processamento? Registros já importados serão preservados.</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void action(job.id, "cancel", job.updatedAt)}>Confirmar cancelamento</button><button type="button" className={button} disabled={busy} onClick={() => setCancelId(null)}>Manter processamento</button></div></div> : null}
      </li>)}</ul> : <p className="py-5 text-sm text-slate-600">Nenhum envio encontrado{filter === "all" ? ". Selecione o arquivo para começar." : " nesta situação."}</p>}
      {pages > 1 ? <nav aria-label="Páginas do histórico de envios" className="mt-3 flex flex-wrap items-center gap-3"><button className={button} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><span className="text-sm">Página {currentPage + 1} de {pages}</span><button className={button} disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Próxima</button></nav> : null}
    </div> : null}
  </section>;
}
