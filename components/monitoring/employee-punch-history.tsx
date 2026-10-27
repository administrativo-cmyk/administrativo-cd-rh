"use client";
import { attendanceHistorySnapshotSchema } from "@/lib/monitoring/attendance-history-contracts";
import { useCallback, useEffect, useState } from "react";
import { dashboardButton as button, dashboardInput as input } from "@/components/dashboards/format";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { formatSignedMinutes } from "@/lib/domain/bank-hours";
import type { BankDay, PunchRole } from "@/lib/monitoring/bank-day";
import type { WorkObservation } from "@/lib/monitoring/work-observation";
import { duration } from "./shared";
import { suggestedWorkMarks } from "@/lib/monitoring/work-observation-view";
import { MeasurementEditor, type MeasurementEditorState } from "@/components/time-bank-admin/measurement-editor";
import { bankAdminSnapshotSchema, type BankAdminMutation, type BankAdminSnapshot } from "@/lib/time-bank-admin/contracts";

const roles: Record<PunchRole, string> = { start: "Entrada", breakStart: "Saída para intervalo", breakEnd: "Retorno do intervalo", end: "Saída do expediente" };
const roleOrder = ["start", "breakStart", "breakEnd", "end"] as const;
type Day = { date: string; bankDay: BankDay | null; correctionVersion: string | null; workObservation?: WorkObservation | null };
type Snapshot = { days: Day[]; canEdit: boolean; bank: { saldo_minutos: number; aplica_a_partir_de: string; automatic: boolean; movementMinutes: number } | null; correctionHistory: Array<{ date: string; at: string; reason: string; actorName: string }>;archive?:{cutoff:string;used:boolean;records:number} };
const time = (at: number) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(at);
const localInput = (at: number | null) => at === null ? "" : new Date(at - 3 * 3_600_000).toISOString().slice(0, 16);
async function request(url: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal, ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "Não foi possível concluir a operação.");
  return value;
}
export function EmployeePunchHistory({ employeeId, date = todayInSaoPaulo(), initialStart, initialEnd }: { employeeId: string; date?: string; initialStart?: string; initialEnd?: string }) {
  const today = todayInSaoPaulo();
  const [start, setStart] = useState(initialStart ?? `${date.slice(0, 7)}-01`);
  const [end, setEnd] = useState(initialEnd && initialEnd <= today ? initialEnd : date > today ? today : date);
  const [period, setPeriod] = useState({ start, end });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<Day | null>(null); const [marks, setMarks] = useState<string[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<(string | null)[]>([]); const [reason, setReason] = useState(""); const [saving, setSaving] = useState(false);
  const [bankData, setBankData] = useState<BankAdminSnapshot | null>(null); const [bankEditor, setBankEditor] = useState<MeasurementEditorState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    request(`/api/monitoring/attendance-history?${new URLSearchParams({ employeeId, ...period })}`, undefined, controller.signal)
      .then(value => { if (controller.signal.aborted) return; const parsed = attendanceHistorySnapshotSchema.safeParse(value); if (!parsed.success) throw new Error("O servidor não confirmou o histórico. Atualize a consulta."); setSnapshot(parsed.data); setError(""); }).catch(cause => { if (!controller.signal.aborted) { setSnapshot(null); setError(cause instanceof Error ? cause.message : "Falha ao consultar ponto."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [employeeId, period, revision]);
  const refresh = useCallback(() => { setLoading(true); setRevision(value => value + 1); }, []);
  function openCorrection(day: Day) {
    setEditing(day); setReason(""); setError(""); setNotice("");
    setMarks(roleOrder.map(role => localInput(day.bankDay?.slots.find(slot => slot.role === role)?.at ?? null)));
    setEvidenceIds([null, null, null, null]);
  }
  async function saveCorrection(event: React.FormEvent) {
    event.preventDefault(); if (!editing || saving) return;
    setSaving(true); setError("");
    try {
      await request("/api/monitoring/attendance-history", { employeeId, ...period, date: editing.date, expectedUpdatedAt: editing.correctionVersion, reason,
        punches: marks.map((value, index) => ({ at: new Date(`${value}:00-03:00`).toISOString(), evidenceId: evidenceIds[index] })) });
      setEditing(null); setNotice("Correção auditada. O recálculo foi enfileirado; as batidas originais permanecem no histórico."); refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar correção."); }
    finally { setSaving(false); }
  }
  async function openBank(mode: "new" | "edit") {
    setError(""); setSaving(true);
    try {
      const data = bankAdminSnapshotSchema.parse(await request(`/api/time-bank-admin?${new URLSearchParams({ employeeId, state: "active", limit: "200" })}`));
      setBankData(data);
      const latest = [...data.rows].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
      if (mode === "edit" && !latest) throw new Error("Sem medição para editar. Cadastre uma nova medição.");
      setBankEditor({ mode: "save", row: mode === "edit" ? latest : null });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar banco."); }
    finally { setSaving(false); }
  }
  async function saveBank(mutation: BankAdminMutation) {
    await request("/api/time-bank-admin", mutation);
    setBankEditor(null); setNotice("Medição salva com auditoria. A vigência determina o início do novo ciclo."); refresh();
  }
  const ready = snapshot?.days.filter(day => day.bankDay?.state === "ready") ?? [];
  const total = ready.reduce((sum, day) => sum + (day.bankDay?.deltaMinutes ?? 0), 0);
  return <section aria-label="Histórico de ponto e banco de horas" className="space-y-3 border-t border-slate-200 pt-4">
    <h3 className="font-semibold text-slate-950">Batidas e saldo diário</h3>
    <p className="text-xs text-slate-600">Dois relógios, uma jornada por colaborador. Turnos noturnos pertencem ao dia de entrada. Horários de São Paulo.</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setLoading(true); setEditing(null); setPeriod({ start, end }); setRevision(value => value + 1); }}>
      <label className="min-w-36 flex-1 text-xs">De<input type="date" required className={input} value={start} max={end} onChange={event => setStart(event.target.value)} /></label>
      <label className="min-w-36 flex-1 text-xs">Até<input type="date" required className={input} value={end} min={start} max={today} onChange={event => setEnd(event.target.value)} /></label>
      <button className={button} disabled={saving || loading}>Consultar até 31 dias</button>
    </form>
    {loading ? <p role="status" className="text-sm">Carregando batidas…</p> : null}
    {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}
    {notice ? <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{notice}</p> : null}
    {snapshot ? <>
      {snapshot.archive?.used?<p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">Histórico privado: {snapshot.archive.records} batida(s) recuperada(s) do arquivo. O banco operacional mantém os últimos três meses, desde {snapshot.archive.cutoff.split("-").reverse().join("/")}. Os originais estão preservados.</p>:null}
      <div className="rounded-lg bg-slate-50 p-3 text-sm"><p>Prévia dos dias apurados: <strong className={total < 0 ? "text-rose-800" : "text-emerald-800"}>{formatSignedMinutes(total)}</strong> · {snapshot.days.length - ready.length} dia(s) pendente(s).</p>
        {snapshot.bank ? <><p className="mt-2">Saldo do banco: <strong>{formatSignedMinutes(snapshot.bank.saldo_minutos)}</strong> · Vigência: {snapshot.bank.aplica_a_partir_de.split("-").reverse().join("/")}</p><p className="mt-1 text-xs">{snapshot.bank.automatic ? `Movimentos já processados desde a vigência: ${formatSignedMinutes(snapshot.bank.movementMinutes)}. Dias pendentes não movimentam o banco.` : "Cálculo automático aguardando a nova medição datada. Esta prévia não altera o saldo oficial atual."}</p></> : <p className="mt-2">Sem medição do banco. Envie o extrato atualizado com a data de vigência.</p>}
        {snapshot.canEdit ? <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={saving} onClick={() => void openBank("edit")}>Editar saldo manual</button><button className={button} disabled={saving} onClick={() => void openBank("new")}>Nova medição datada</button></div> : null}
      </div>
      <p className="text-xs text-slate-600">Duas batidas: intervalo menos 1h de almoço. Três batidas: saldo pendente até RH ou ADMIN corrigir. Crédito e débito exigem horário e coleta completos confirmados.</p>
      <div className="space-y-2">{snapshot.days.map(day => <details key={day.date} className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm"><b>{day.date.split("-").reverse().join("/")}</b> · {day.bankDay?.state === "ready" ? <strong className={day.bankDay.deltaMinutes! < 0 ? "text-rose-800" : "text-emerald-800"}>{formatSignedMinutes(day.bankDay.deltaMinutes!)}</strong> : <span className="font-semibold text-amber-900">Pendente</span>} · {day.bankDay?.punches.length ?? 0} batida(s)</summary>
        <p className="mt-2 text-xs text-slate-600">{day.bankDay?.reason ?? "Jornada ainda não apurada"}</p>
        {day.workObservation ? <div className="mt-2 space-y-1 text-xs"><p>Trabalho observado: <b>{duration(day.workObservation.workedSeconds)}</b> · {day.workObservation.restBasis === "turnstile-suggestion" ? "Descanso sugerido" : "Descanso registrado"}: {duration(day.workObservation.restSeconds)}{!day.workObservation.restBasis || day.workObservation.restBasis === "not-recorded" ? " — sem descanso registrado." : ""}</p>{suggestedWorkMarks(day.workObservation).map(mark => <p key={`${mark.eventId}:${mark.role}`} className="font-semibold text-red-700">{time(mark.at)} · {roles[mark.role]} · Sugestão do torniquete · {mark.pointId}</p>)}<p className="text-slate-600">{day.workObservation.reason}</p></div> : null}
        <ul className="mt-2 space-y-1 text-xs">{day.bankDay?.punches.map(punch => <li key={punch.id}>{time(punch.at)} · {punch.sourceId === "rh-correction" ? "Correção RH / ADMIN" : punch.sourceId}{punch.role ? ` · ${roles[punch.role]}` : ""}</li>)}</ul>
        {day.bankDay?.originalPunches ? <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold">Batidas originais dos relógios</summary><ul className="mt-2 space-y-1">{day.bankDay.originalPunches.map(punch => <li key={punch.id}>{time(punch.at)} · {punch.sourceId}</li>)}</ul></details> : null}
        {day.bankDay?.slots.filter(slot => slot.at === null).map(slot => <p key={slot.role} className="mt-2 text-sm text-amber-900">Provável batida faltante: {roles[slot.role]} — em branco para conferência.</p>)}
        {day.bankDay?.suppressedIds.length ? <p className="mt-2 text-xs">{day.bankDay.suppressedIds.length} repetição(ões) entre relógios preservada(s) na origem.</p> : null}
        {day.bankDay?.suggestions.length ? <p className="mt-2 text-xs">Há passagem compatível no torniquete para conferência do RH. A autorização de acesso é evidência auxiliar.</p> : null}
        {snapshot.canEdit ? <button type="button" className={`${button} mt-3`} disabled={saving} onClick={() => openCorrection(day)}>Conferir / corrigir batidas</button> : null}
      </details>)}</div>
      {editing ? <form onSubmit={saveCorrection} className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
        <h4 className="font-semibold">Correção de {editing.date.split("-").reverse().join("/")} · RH / ADMIN</h4>
        <p className="text-xs">Preencha as quatro batidas em ordem. As datas mostram a virada do turno noturno. Registros originais são preservados.</p>
        {roleOrder.map((role, index) => <label key={role} className="block text-sm">{roles[role]}<input required type="datetime-local" className={input} value={marks[index]} onChange={event => { setMarks(values => values.map((value, i) => i === index ? event.target.value : value)); setEvidenceIds(values => values.map((value, i) => i === index ? null : value)); }} /></label>)}
        {editing.bankDay?.suggestions.map(suggestion => <button key={suggestion.eventId} type="button" className={`${button} text-left`} onClick={() => { const index = roleOrder.indexOf(editing.bankDay!.missingRole!); if (index < 0) return; setMarks(values => values.map((value, i) => i === index ? localInput(suggestion.at) : value)); setEvidenceIds(values => values.map((value, i) => i === index ? suggestion.eventId : value)); }}>Usar sugestão {time(suggestion.at)} · {suggestion.pointId} · {suggestion.direction === "entry" ? "Entrada" : "Saída"}</button>)}
        <label className="block text-sm">Justificativa<textarea required minLength={5} maxLength={1000} className={input} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2"><button className={`${button} border-blue-700 text-blue-900`} disabled={saving}>{saving ? "Salvando…" : "Confirmar correção auditada"}</button><button type="button" className={button} disabled={saving} onClick={() => setEditing(null)}>Cancelar</button></div>
      </form> : null}
      {snapshot.correctionHistory.length ? <details className="text-xs"><summary className="cursor-pointer font-semibold">Histórico de correções</summary><ul className="mt-2 space-y-2">{snapshot.correctionHistory.map((item, index) => <li key={index}>{item.date} · {item.actorName} · {time(Date.parse(item.at))}<p>{item.reason}</p></li>)}</ul></details> : null}
    </> : null}
    {bankEditor && bankData ? <MeasurementEditor editor={bankEditor} employees={bankData.employees.filter(employee => employee.id === employeeId)} today={today} onClose={() => setBankEditor(null)} onSave={saveBank} /> : null}
  </section>;
}
