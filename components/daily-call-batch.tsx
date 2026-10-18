"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { attendanceCodes, type AttendanceCode, type Employee } from "@/lib/daily-call-types";
import { attendanceMeta } from "@/lib/daily-call-rules";
import { validPeriod } from "@/lib/data/daily-call-dates";
import { batchPreviewSchema, type BatchData, type BatchPreview } from "@/lib/daily-call-operations";
export const dailyOperationButton = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-600";
export const dailyOperationInput = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
export async function dailyOperationRequest(url: string, data: unknown) {
 const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
 const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir a operação."); return result;
}
function dates(start: string, end: string) {
 if (!validPeriod(start, end)) return [];
 const output: string[] = []; const current = new Date(`${start}T12:00:00Z`);
 while (current.toISOString().slice(0, 10) <= end) { output.push(current.toISOString().slice(0, 10)); current.setUTCDate(current.getUTCDate() + 1); }
 return output;
}
export function DailyCallBatch({ employees, date, onChanged, disabled }: { employees: Employee[]; date: string; onChanged: () => void; disabled?: boolean }) {
 const [open, setOpen] = useState(false); const [selected, setSelected] = useState<string[]>([]);
 const [start, setStart] = useState(date); const [end, setEnd] = useState(date);
 const [status, setStatus] = useState<AttendanceCode>("P"); const [mode, setMode] = useState<BatchData["mode"]>("fill_blank");
 const [observation, setObservation] = useState(""); const [reason, setReason] = useState("");
 const [preview, setPreview] = useState<BatchPreview | null>(null); const [proposal, setProposal] = useState<BatchData | null>(null);
 const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
 const eligibleEmployees = employees.filter(employee => employee.databaseId && selected.includes(employee.databaseId));
 const count = eligibleEmployees.length * dates(start, end).length;
 function invalidate() { setPreview(null); setProposal(null); setError(""); }
 async function loadPreview() {
  if (!validPeriod(start, end) || count < 1 || count > 100 || reason.trim().length < 5) { setError("Selecione colaboradores, período de até 31 dias e motivo. Limite: 100 pessoa-datas."); return; }
  const data: BatchData = { mode, reason, items: eligibleEmployees.flatMap(employee => dates(start, end).map(day => ({ employeeId: employee.databaseId!, date: day, status, observation: observation.trim() || null }))) };
  setBusy(true); setError("");
  try { setPreview(batchPreviewSchema.parse(await dailyOperationRequest("/api/daily-call/batch", { action: "preview", data }))); setProposal(data); }
  catch (cause) { setError(cause instanceof Error ? cause.message : "Falha na prévia."); } finally { setBusy(false); }
 }
 async function apply() {
  if (!preview || !proposal) return; setBusy(true); setError("");
  try { const result = await dailyOperationRequest("/api/daily-call/batch", { action: "apply", data: { ...proposal, expectedVersion: preview.version } }); setMessage(`${result.reviewed} lançamento(s) revisado(s), ${result.changed} alterado(s), ${result.skipped} preservado(s).`); setOpen(false); invalidate(); onChanged(); }
  catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar lote."); setPreview(null); setProposal(null); } finally { setBusy(false); }
 }
 return <section className="space-y-2"><button className={dailyOperationButton} disabled={disabled} onClick={() => { setStart(date); setEnd(date); invalidate(); setOpen(true); }}>Preencher ou revisar em lote</button>{message ? <p role="status" className="text-sm text-emerald-800">{message}</p> : null}
 <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Revisão em lote da Chamada</DialogTitle><DialogDescription>Escolha pessoas do filtro atual e confira a prévia. O lote inteiro é recusado se algum dado mudar antes da confirmação.</DialogDescription></DialogHeader>
 <div className="grid gap-3 sm:grid-cols-2"><label>De<input type="date" value={start} disabled={busy} className={dailyOperationInput} onChange={e => { setStart(e.target.value); invalidate(); }}/></label><label>Até<input type="date" value={end} disabled={busy} className={dailyOperationInput} onChange={e => { setEnd(e.target.value); invalidate(); }}/></label><label>Status<select value={status} disabled={busy} className={dailyOperationInput} onChange={e => { setStatus(e.target.value as AttendanceCode); invalidate(); }}>{attendanceCodes.map(code => <option key={code} value={code}>{code} · {attendanceMeta[code].label}</option>)}</select></label><label>Aplicação<select value={mode} disabled={busy} className={dailyOperationInput} onChange={e => { setMode(e.target.value as BatchData["mode"]); invalidate(); }}><option value="fill_blank">Preencher somente campos vazios</option><option value="replace">Revisar e substituir os selecionados</option></select></label></div>
 <fieldset className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 p-3"><legend className="px-1 text-sm font-semibold">Colaboradores do filtro atual</legend>{employees.filter(employee => employee.databaseId).map(employee => <label key={employee.databaseId} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(employee.databaseId!)} disabled={busy} onChange={e => { setSelected(current => e.target.checked ? [...current, employee.databaseId!] : current.filter(id => id !== employee.databaseId)); invalidate(); }}/>{employee.name} · {employee.id}</label>)}</fieldset>
 <p className="text-sm text-slate-600">{count} pessoa-data(s), máximo 100. Campos existentes só serão substituídos no modo de revisão explícita.</p>
 <label>Observação comum<textarea maxLength={500} disabled={busy} value={observation} className={dailyOperationInput} onChange={e => { setObservation(e.target.value); invalidate(); }}/></label><label>Motivo do lote<textarea minLength={5} maxLength={500} disabled={busy} value={reason} className={dailyOperationInput} onChange={e => { setReason(e.target.value); invalidate(); }}/></label>
 {error ? <p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-800">{error} Os campos foram mantidos.</p> : null}
 {preview ? <section aria-label="Prévia do lote" className="space-y-2 rounded-lg border border-blue-200 p-3"><p className="font-semibold">{preview.eligible} de {preview.total} lançamento(s) elegíveis</p><p className="text-xs text-slate-600">{preview.rows.filter(row => row.eligible && row.status === "G" && row.currentStatus !== "G").length} novo(s) G; {preview.rows.filter(row => row.eligible && row.status !== "G" && row.currentStatus === "G").length} G substituído(s). O saldo será recalculado pelos registros da Chamada.</p><ul className="max-h-56 divide-y overflow-y-auto">{preview.rows.map(row => <li key={`${row.employeeId}:${row.date}`} className="py-2 text-sm"><b>{row.name}</b> · {row.date} · {row.currentStatus ?? "Em branco"} → {row.eligible ? row.status : "Preservado"}<span className="block text-xs text-slate-600">{row.explanation}{row.origin === "manual" ? " · Origem manual" : ""}</span></li>)}</ul></section> : null}
 <div className="flex flex-wrap gap-2"><button className={dailyOperationButton} disabled={busy || !count || count > 100} onClick={() => void loadPreview()}>{busy ? "Processando…" : "Gerar prévia"}</button><button className={dailyOperationButton} disabled={busy || !preview?.eligible} onClick={() => void apply()}>Confirmar lote conferido</button><button className={dailyOperationButton} disabled={busy} onClick={() => setOpen(false)}>Cancelar</button></div>
 </DialogContent></Dialog></section>;
}
