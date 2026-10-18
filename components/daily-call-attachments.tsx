"use client";
import { useEffect, useRef, useState } from "react";
import { attachmentLimit, type DailyCallAttachment } from "@/lib/daily-call-operations";
import { dailyOperationButton as button, dailyOperationInput as input, dailyOperationRequest } from "./daily-call-batch";
export function DailyCallAttachments({ employeeId, date: initialDate, canWrite }: { employeeId: string; date: string; canWrite: boolean }) {
 const [date, setDate] = useState(initialDate); const [rows, setRows] = useState<DailyCallAttachment[]>([]); const [includeArchived, setIncludeArchived] = useState(false);
 const [description, setDescription] = useState(""); const [reason, setReason] = useState(""); const [file, setFile] = useState<File | null>(null);
 const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [refresh, setRefresh] = useState(0);
 const fileInput = useRef<HTMLInputElement>(null);
 useEffect(() => {
  const abort = new AbortController();
  Promise.resolve().then(async () => { if (abort.signal.aborted) return; setLoading(true); setError("");
   try { const response = await fetch(`/api/daily-call/attachments?${new URLSearchParams({ employeeId, date })}`, { cache: "no-store", signal: abort.signal }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Falha na consulta."); if (!abort.signal.aborted) setRows(data.rows); }
   catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha na consulta."); } finally { if (!abort.signal.aborted) setLoading(false); }
  }); return () => abort.abort();
 }, [employeeId, date, refresh]);
 async function upload() {
  if (!file || file.size > attachmentLimit || !file.size) { setError("Selecione um arquivo de até 2 MiB."); return; }
  setBusy(true); setError("");
  try {
   const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file); });
   await dailyOperationRequest("/api/daily-call/attachments", { employeeId, date, fileName: file.name, mediaType: file.type, content, description });
   setFile(null); setDescription(""); if (fileInput.current) fileInput.current.value = ""; setRefresh(value => value + 1);
  } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha no envio."); } finally { setBusy(false); }
 }
 async function change(row: DailyCallAttachment) {
  if (reason.trim().length < 5) { setError("Informe o motivo para arquivar ou restaurar (mínimo 5 caracteres)."); return; }
  setBusy(true); setError("");
  try { await dailyOperationRequest("/api/daily-call/attachments", { action: row.archivedAt ? "restore" : "archive", data: { id: row.id, expectedUpdatedAt: row.updatedAt, reason } }); setReason(""); setRefresh(value => value + 1); }
  catch (cause) { setError(cause instanceof Error ? cause.message : "Falha na alteração."); } finally { setBusy(false); }
 }
 return <section className="space-y-3 rounded-xl border border-slate-200 p-3" aria-label="Anexos da justificativa"><h3 className="font-semibold">Anexos da justificativa</h3><label className="block text-sm">Data do lançamento<input type="date" className={input} disabled={busy} value={date} onChange={e => setDate(e.target.value)}/></label><p className="text-xs text-slate-600">PDF, PNG ou JPEG de até 2 MiB. Até 5 ativos; 10 versões e 10 MiB por pessoa/data, incluindo arquivados. Salve o lançamento antes de anexar.</p>
 {loading ? <p role="status" className="text-sm">Carregando anexos…</p> : null}{error ? <p role="alert" className="text-sm text-rose-800">{error}</p> : null}
 <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)}/>Incluir anexos arquivados</label>
 {!loading && !error ? <ul className="space-y-3">{rows.filter(row => includeArchived || !row.archivedAt).map(row => <li key={row.id} className="rounded-lg bg-slate-50 p-3 text-sm"><b className="break-all">{row.fileName}</b><p>{row.description}</p><p className="text-xs text-slate-500">{Math.ceil(row.size / 1024)} KiB · {row.archivedAt ? "Arquivado" : "Disponível"}</p><div className="mt-2 flex flex-wrap gap-2">{!row.archivedAt ? <a className={button} href={`/api/daily-call/attachments?id=${row.id}`}>Baixar anexo</a> : null}{canWrite ? <button className={button} disabled={busy} onClick={() => void change(row)}>{row.archivedAt ? "Restaurar" : "Arquivar"}</button> : null}</div></li>)}{!rows.length ? <li className="text-sm text-slate-500">Nenhum anexo nesta data.</li> : null}</ul> : null}
 {canWrite ? <><label className="block text-sm">Motivo para arquivar ou restaurar<textarea value={reason} maxLength={500} disabled={busy} className={input} onChange={e => setReason(e.target.value)}/></label><form className="space-y-2 border-t border-slate-200 pt-3" onSubmit={e => { e.preventDefault(); void upload(); }}><label className="block text-sm">Arquivo privado<input ref={fileInput} type="file" accept="application/pdf,image/png,image/jpeg" className={input} disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)}/></label><label className="block text-sm">Descrição da justificativa<textarea required minLength={5} maxLength={500} value={description} disabled={busy} className={input} onChange={e => setDescription(e.target.value)}/></label><button className={button} disabled={busy || loading || !file}>{busy ? "Enviando…" : "Enviar anexo privado"}</button></form></> : null}
 </section>;
}
