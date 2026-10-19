"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { workflowSnapshotSchema, type DailyCallWorkflowDay, type DailyCallWorkflowRow, type DailyCallWorkflowSnapshot } from "@/lib/daily-call-workflow";
import { attendanceCodes, type AttendanceCode } from "@/lib/daily-call-types";
import { attendanceMeta } from "@/lib/daily-call-rules";
import { todayInSaoPaulo, validPeriod } from "@/lib/data/daily-call-dates";

const buttonBase = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50";
const buttonClass = `${buttonBase} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const primaryClass = `${buttonBase} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`;
const inputClass = "mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600";
const dayPageSize = 8;
const originLabels = { punch: "Pelo ponto", automatic_absence: "Falta automática", manual: "Revisão manual" };
const stateLabels: Record<DailyCallWorkflowRow["state"], string> = { present: "Presença identificada", automatic_absence: "Falta automática", manual: "Lançamento manual preservado", pending_manager: "Aguarda decisão do gestor", blocked: "Conferência necessária", not_expected: "Sem jornada prevista" };
const blockerLabels: Record<string, string> = {
  WEEKLY_ROSTER_UNCONFIRMED: "Horário estimado; ciclo de trabalho e folga a confirmar",
  ADMISSION_UNKNOWN: "Data de admissão não confirmada", BEFORE_ADMISSION: "Data anterior à admissão", NOT_ACTIVE: "Colaborador fora da situação ativa",
  SCHEDULE_UNKNOWN: "Escala não cadastrada", DAY_OPEN: "Dia ou jornada ainda em aberto", PUNCH_COVERAGE_UNCONFIRMED: "Cobertura do ponto não confirmada",
  SCHEDULE_OVERLAP: "Escalas com jornadas sobrepostas",
  BALANCE_REQUIRES_RECONCILIATION: "Saldo de banco de horas exige conciliação", IMPORT_REPROCESS_PENDING: "Importação ou recálculo pendente", IDENTITY_BINDING_CONFLICT: "Vínculo de identidade divergente",
  NO_COVERAGE: "Cobertura do ponto não confirmada", COVERAGE_MISSING: "Cobertura do ponto não confirmada", PUNCH_COVERAGE_MISSING: "Cobertura do ponto não confirmada",
  NO_SCHEDULE: "Escala não cadastrada", SCHEDULE_MISSING: "Escala não cadastrada", SCHEDULE_CONFLICT: "Escalas divergentes",
  IDENTITY_PENDING: "Identidade sem conciliação", IDENTITY_CONFLICT: "Vínculo de identidade divergente", NO_IDENTITY: "Identidade sem conciliação",
  BANK_MISSING: "Saldo de banco de horas indisponível", NO_BANK: "Saldo de banco de horas indisponível", BALANCE_UNKNOWN: "Saldo de banco de horas indisponível",
  FUTURE_DATE: "Data futura", JOURNEY_NOT_CLOSED: "Jornada ainda não encerrada", COVERAGE_INCOMPLETE: "Coleta de ponto incompleta",
};
function dayLabel(date: string) { return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", dateStyle: "short" }).format(new Date(`${date}T12:00:00Z`)); }
function balanceLabel(minutes: number | null) { if (minutes === null) return "Sem saldo confirmado"; const value = Math.abs(minutes); return `${minutes < 0 ? "−" : ""}${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}min`; }
async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.error ?? "Não foi possível carregar a fila."}${body.correlationId ? ` Referência: ${body.correlationId}` : ""}`);
  return body as T;
}
function useQueue(start: string, end: string, refresh: number, offset = 0, managerId?: string | null, enabled = true) {
  const [snapshot, setSnapshot] = useState<DailyCallWorkflowSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    Promise.resolve().then(async () => {
      if (abort.signal.aborted) return;
      if (!enabled) { setSnapshot(null); setLoading(false); setError(""); return; }
      setLoading(true); setError("");
      if (!validPeriod(start, end)) throw new Error("Selecione um período válido de até 31 dias para consultar pendências.");
      const params = new URLSearchParams({ start, end, offset: String(offset), limit: "50" });
      if (managerId !== undefined) params.set("managerId", managerId ?? "none");
      const result = workflowSnapshotSchema.parse(await readJson(`/api/daily-call/pending?${params}`, { signal: abort.signal }));
      if (!abort.signal.aborted) setSnapshot(result);
    }).catch((cause) => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha ao consultar pendências."); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [start, end, offset, managerId, refresh, enabled]);
  return { snapshot: snapshot?.start === start && snapshot.end === end ? snapshot : null, loading, error };
}

export function DailyCallPending({ start, end, canWrite, onChanged, refreshToken = 0 }: { start: string; end: string; canWrite: boolean; onChanged: () => void; refreshToken?: number }) {
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState<DailyCallWorkflowDay | null>(null);
  const today = todayInSaoPaulo();
  const lastClosedDay = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const effectiveEnd = end < lastClosedDay ? end : lastClosedDay;
  const hasClosedDays = validPeriod(start, end) && start <= effectiveEnd;
  const { snapshot, loading, error } = useQueue(start, effectiveEnd, refresh + refreshToken, 0, undefined, hasClosedDays);
  const selected = selection && selection.date >= start && selection.date <= effectiveEnd ? selection : null;
  const counts = snapshot?.counts;
  function changed() { setRefresh((value) => value + 1); onChanged(); }
  return <section aria-label="Pendências da chamada" className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-bold"><ClipboardCheck size={17} className="text-blue-600" />Revisão diária da chamada</h2><p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-600">O ponto preenche a presença. Sem batida, a falta automática exige jornada e coleta conferidas e saldo de até 8h. Saldo acima de 8h permanece em branco para decisão do gestor. Lançamentos manuais são preservados.</p></div><button className={buttonClass} disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} />Atualizar fila</button></div>
    <p className="mt-2 text-xs text-slate-500">F = Folga · I = Falta injustificada · G = Abono / Justificado / Compensação. Finalizar registra a revisão do dia e exige resolver suas pendências.</p>
    <p className="mt-2 text-xs font-medium text-slate-600">{hasClosedDays ? `Período de revisão: ${dayLabel(start)} a ${dayLabel(effectiveEnd)}. Apenas dias encerrados em America/Sao_Paulo.` : "A fila de revisão considera apenas dias encerrados. Não há dias encerrados no período selecionado."}</p>
    {loading ? <p role="status" className="mt-3 text-xs text-slate-500">Consultando pendências…</p> : null}
    {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}
    {counts ? <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs"><span><b>{counts.present}</b> presença(s) pelo ponto</span><span><b>{counts.automaticAbsence}</b> falta(s) automáticas</span><span><b>{counts.manual}</b> lançamento(s) manuais</span><span className="text-amber-900"><b>{counts.pending}</b> aguardando gestor</span><span className="text-rose-800"><b>{counts.blocked}</b> com conferência pendente</span></div> : null}
    {snapshot ? <DailyCallDayList key={`${start}|${effectiveEnd}`} days={snapshot.days} loading={loading} onSelect={setSelection} /> : null}
    {selected ? <DailyCallDayReview key={`${selected.date}|${selected.managerId}`} day={selected} canWrite={canWrite} onClose={() => setSelection(null)} onChanged={changed} /> : null}
  </section>;
}

function DailyCallDayList({ days, loading, onSelect }: { days: DailyCallWorkflowDay[]; loading: boolean; onSelect: (day: DailyCallWorkflowDay) => void }) {
  const [dateFilter, setDateFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [page, setPage] = useState(0);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const dates = [...new Set(days.map((day) => day.date))].sort().reverse();
  const managers = [...new Map(days.map((day) => [day.managerId ?? "none", day.managerName])).entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const filtered = days.filter((day) => (!dateFilter || day.date === dateFilter) && (!managerFilter || (day.managerId ?? "none") === managerFilter));
  const pageCount = Math.max(1, Math.ceil(filtered.length / dayPageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const first = currentPage * dayPageSize;
  const visibleDays = filtered.slice(first, first + dayPageSize);
  function goToPage(next: number) { setPage(next); if (regionRef.current) regionRef.current.scrollTop = 0; }
  return <div className="mt-3 space-y-2" aria-busy={loading}>
    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
      <label className="text-xs font-semibold text-slate-600">Dia da revisão<select value={dateFilter} disabled={loading} onChange={(event) => { setDateFilter(event.target.value); goToPage(0); }} className={inputClass}><option value="">Todos os dias</option>{dates.map((date) => <option key={date} value={date}>{dayLabel(date)}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">Gestor da revisão<select value={managerFilter} disabled={loading} onChange={(event) => { setManagerFilter(event.target.value); goToPage(0); }} className={inputClass}><option value="">Todos os gestores</option>{managers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    </div>
    <p className="text-xs text-slate-500">Os totais acima consideram todo o período. Os filtros selecionam os grupos para revisão.</p>
    <div ref={regionRef} role="region" aria-label="Dias e gestores para revisão" tabIndex={0} className="max-h-64 overflow-auto rounded-lg border border-slate-200 scroll-pt-10 focus-visible:outline-2 focus-visible:outline-blue-600">
      <table className="w-full min-w-[650px] text-left text-xs"><caption className="sr-only">Revisões agrupadas por dia e gestor</caption><thead className="sticky top-0 z-10 bg-slate-50 text-slate-500"><tr>{["Dia", "Gestor", "Pelo ponto", "Falta automática", "Aguardando gestor", "Conferência", "Revisão"].map((label) => <th key={label} scope="col" className="px-3 py-2 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{visibleDays.map((day) => <tr key={`${day.date}|${day.managerId}`}><td className="whitespace-nowrap px-3 py-2">{dayLabel(day.date)}</td><td className="px-3 py-2">{day.managerName}</td><td className="px-3 py-2">{day.present}</td><td className="px-3 py-2">{day.automaticAbsence}</td><td className="px-3 py-2 font-semibold text-amber-900">{day.pending}</td><td className="px-3 py-2 font-semibold text-rose-800">{day.blocked}</td><td className="px-3 py-2"><button className={buttonClass} onClick={() => onSelect(day)} disabled={loading} aria-label={`Revisar ${dayLabel(day.date)} de ${day.managerName}`}>{day.closedAt ? "Revisão finalizada" : "Revisar dia"}</button></td></tr>)}</tbody></table>
      {!visibleDays.length ? <p className="p-4 text-sm text-slate-500">{days.length ? "Nenhum grupo corresponde aos filtros selecionados." : "Nenhum dia de revisão no período e escopo selecionados."}</p> : null}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
      <p role="status" aria-live="polite">{filtered.length ? first + 1 : 0}–{Math.min(first + dayPageSize, filtered.length)} de {filtered.length} {filtered.length === 1 ? "grupo" : "grupos"}{filtered.length !== days.length ? ` · ${days.length} no período` : ""}</p>
      <nav aria-label="Páginas da fila de revisão" className="flex items-center gap-2"><button className={`${buttonClass} min-h-11 sm:min-h-9`} aria-label="Página anterior da fila" disabled={loading || currentPage === 0} onClick={() => goToPage(currentPage - 1)}>Anterior</button><span className="tabular-nums">{currentPage + 1} / {pageCount}</span><button className={`${buttonClass} min-h-11 sm:min-h-9`} aria-label="Próxima página da fila" disabled={loading || currentPage + 1 >= pageCount} onClick={() => goToPage(currentPage + 1)}>Próxima</button></nav>
    </div>
  </div>;
}

function DailyCallDayReview({ day, canWrite, onClose, onChanged }: { day: DailyCallWorkflowDay; canWrite: boolean; onClose: () => void; onChanged: () => void }) {
  const [refresh, setRefresh] = useState(0);
  const [offset, setOffset] = useState(0);
  const { snapshot, loading, error } = useQueue(day.date, day.date, refresh, offset, day.managerId);
  const [editing, setEditing] = useState<DailyCallWorkflowRow | null>(null);
  const [status, setStatus] = useState<AttendanceCode | "">("");
  const [observation, setObservation] = useState("");
  const [reason, setReason] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const editorRef = useRef<HTMLFormElement | null>(null);
  useEffect(() => { editorRef.current?.scrollIntoView({ block: "nearest" }); }, [editing]);
  const currentDay = snapshot?.days.find((item) => item.date === day.date && item.managerId === day.managerId);
  const canClose = day.date < todayInSaoPaulo() && !!snapshot && snapshot.counts.pending === 0 && snapshot.counts.blocked === 0 && snapshot.counts.total > 0;
  async function mutate(action: "resolve" | "close", data: unknown) {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      await readJson("/api/daily-call/pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
      setMessage(action === "resolve" ? "Decisão salva. A chamada será atualizada." : "Revisão do dia finalizada.");
      if (action === "resolve") { setEditing(null); setReason(""); setObservation(""); }
      setReviewed(false); setRefresh((value) => value + 1); onChanged();
    } catch (cause) { setFailed(true); setMessage(cause instanceof Error ? cause.message : "Não foi possível salvar. Seu rascunho foi mantido."); }
    finally { setBusy(false); }
  }
  function edit(row: DailyCallWorkflowRow) { setEditing(row); setStatus(row.status ?? ""); setObservation(row.observation ?? ""); setReason(""); setMessage(""); }
  return <Sheet open onOpenChange={(open) => !open && !busy && onClose()}><SheetContent className="w-full overflow-y-auto bg-white p-0 sm:max-w-[900px]">
    <SheetHeader className="border-b border-slate-200 p-5 pr-10"><SheetTitle>Revisão de {dayLabel(day.date)}</SheetTitle><SheetDescription>{day.managerName} · Somente colaboradores do seu escopo autorizado.</SheetDescription></SheetHeader>
    <div className="space-y-4 p-4 sm:p-5"><p className="text-xs leading-relaxed text-slate-600">Confira ponto, saldo e justificativas. A finalização não escolhe G ou falta por você. Nenhum código é gravado ao abrir esta revisão.</p>
      <button className={buttonClass} disabled={loading || busy} onClick={() => setRefresh((value) => value + 1)}>Atualizar revisão</button>
      {loading ? <p role="status" className="text-sm text-slate-500">Carregando revisão…</p> : null}{error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}
      {message ? <p role={failed ? "alert" : "status"} className={`sticky top-0 z-20 rounded-lg border p-3 text-sm shadow-sm ${failed ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{message}</p> : null}
      {snapshot ? <>
        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-4">{[["Colaboradores", snapshot.counts.total], ["Faltas automáticas", snapshot.counts.automaticAbsence], ["Aguardando gestor", snapshot.counts.pending], ["Conferência pendente", snapshot.counts.blocked]].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 text-lg font-bold">{value}</dd></div>)}</dl>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">{snapshot.rows.map((row) => <li key={`${row.employeeId}|${row.date}`} className="space-y-2 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-bold">{row.name}</h3><p className="text-xs text-slate-500">{row.employeeNumber} · Saldo: {balanceLabel(row.balanceMinutes)}</p></div><span className="rounded-md bg-slate-50 px-2 py-1 text-xs font-semibold">{row.status ? `${row.status} · ${attendanceMeta[row.status].label}` : "Em branco"}</span></div><p className="text-xs text-slate-600">{stateLabels[row.state]}{row.origin ? ` · ${originLabels[row.origin]}` : ""}</p>{row.blockers.length ? <ul className="list-inside list-disc text-xs text-amber-900">{row.blockers.map((blocker) => <li key={blocker}>{blockerLabels[blocker] ?? "Dados insuficientes para uma decisão automática"}</li>)}</ul> : null}{canWrite && row.state !== "not_expected" ? <button className={buttonClass} disabled={busy || loading} onClick={() => edit(row)} aria-label={`Revisar lançamento de ${row.name}`}>Revisar lançamento</button> : null}</li>)}</ul>
        <div className="flex items-center justify-between gap-2 text-xs"><span>{snapshot.counts.total ? offset + 1 : 0}–{Math.min(offset + 50, snapshot.counts.total)} de {snapshot.counts.total}</span><div className="flex gap-2"><button className={buttonClass} disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Anteriores</button><button className={buttonClass} disabled={loading || offset + 50 >= snapshot.counts.total} onClick={() => setOffset((value) => value + 50)}>Próximos</button></div></div>
        {editing && canWrite ? <form ref={editorRef} aria-label={`Decisão de ${editing.name}`} className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4" onSubmit={(event) => { event.preventDefault(); if (status) void mutate("resolve", { employeeId: editing.employeeId, date: editing.date, status, observation: observation.trim() || null, expectedUpdatedAt: editing.updatedAt, expectedDecisionVersion: editing.decisionVersion, reason: reason.trim() }); }}><h3 className="text-sm font-bold">Decisão para {editing.name}</h3><label className="block text-xs font-semibold">Ocorrência<select required value={status} onChange={(event) => setStatus(event.target.value as AttendanceCode)} className={inputClass}><option value="">Selecione após conferir</option>{attendanceCodes.map((code) => <option key={code} value={code}>{code} · {attendanceMeta[code].label}</option>)}</select></label><label className="block text-xs font-semibold">Observação da chamada (opcional)<input value={observation} onChange={(event) => setObservation(event.target.value)} maxLength={500} className={inputClass} /></label><label className="block text-xs font-semibold">Justificativa da decisão<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className={inputClass} /></label><p className="text-xs text-slate-600">G representa abono, justificativa ou compensação conforme a decisão registrada. F é folga; I é falta injustificada.</p><div className="flex gap-2"><button disabled={busy || loading || !status} className={primaryClass}>{busy ? "Salvando…" : "Salvar decisão"}</button><button type="button" disabled={busy} className={buttonClass} onClick={() => setEditing(null)}>Cancelar</button></div></form> : null}
        {canWrite ? <form aria-label="Finalizar revisão do dia" className="space-y-3 rounded-xl border border-slate-200 p-4" onSubmit={(event) => { event.preventDefault(); if (canClose && reviewed) void mutate("close", { date: day.date, managerId: day.managerId, expectedRevision: snapshot.revision, reason: closeReason.trim() }); }}><h3 className="text-sm font-bold">Finalizar revisão do dia</h3>{currentDay?.closedAt ? <p className="text-xs text-emerald-800">Revisão registrada em {new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(currentDay.closedAt))}.</p> : null}<p className="text-xs text-slate-600">{canClose ? "Todos os colaboradores deste dia têm uma definição ou não possuem jornada prevista." : "Resolva os itens aguardando gestor e as conferências pendentes antes de finalizar."}</p><label className="block text-xs font-semibold">Resumo da revisão<textarea required minLength={5} maxLength={500} value={closeReason} onChange={(event) => setCloseReason(event.target.value)} className={inputClass} /></label><label className="flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} disabled={!canClose || busy} />Conferi as ocorrências e justificativas deste dia.</label><button className={primaryClass} disabled={!canClose || !reviewed || busy || loading}>Finalizar revisão</button></form> : <p className="text-xs text-slate-500">Seu acesso permite consultar a revisão.</p>}
      </> : null}
    </div>
  </SheetContent></Sheet>;
}
