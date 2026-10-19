"use client";

import { useEffect, useState } from "react";
import { defaultSchedulePayloadSchema, defaultScheduleSnapshotSchema, standardPayload, STANDARD_SCHEDULES, durationMinutes, type DefaultSchedulePayload, type DefaultScheduleSnapshot } from "@/lib/monitoring/standard-schedules";
import { buttonClass, Field, inputClass, primaryClass, requestJson } from "./monitoring/shared";

export function EmployeeSchedule({ employeeId, date }: { employeeId: string; date: string }) {
  const [data, setData] = useState<DefaultScheduleSnapshot | null>(null);
  const [draft, setDraft] = useState<DefaultSchedulePayload>(() => standardPayload("operational-06"));
  const [validFrom, setValidFrom] = useState(date);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    requestJson("/api/employee-schedule", { method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get", data: { employeeId, date } }) })
      .then(raw => { if (!abort.signal.aborted) { setData(defaultScheduleSnapshotSchema.parse(raw)); setMessage(""); } })
      .catch(() => { if (!abort.signal.aborted) setMessage("Horário indisponível. Tente carregar novamente."); });
    return () => abort.abort();
  }, [employeeId, date, reload]);
  function edit() {
    const payload = data?.setting?.payload;
    setDraft(payload ? { name: String(payload.name), start: String(payload.start), end: String(payload.end), days: payload.days as number[], lunchMinutes: 60,
      estimated: payload.estimated === true, weeklyRosterConfirmed: payload.weeklyRosterConfirmed !== false && payload.estimated !== true,
      monthlySundayOff: payload.monthlySundayOff === true, monthlySundayOffDates: payload.monthlySundayOffDates as string[] ?? [],
      ...(payload.cycle ? { cycle: payload.cycle as DefaultSchedulePayload["cycle"] } : {}), allowNoBreak: false, pairing: "alternating", coffeeWindows: [] } : standardPayload("operational-06"));
    setValidFrom(date); setReason(""); setMessage(""); setEditing(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = defaultSchedulePayloadSchema.safeParse(draft);
    if (!parsed.success) { setMessage(parsed.error.issues.map(i => i.message).join(" · ")); return; }
    setBusy(true); setMessage("");
    try {
      const raw = await requestJson("/api/employee-schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", data: { employeeId, date, validFrom, expectedVersion: data!.version, reason, payload: parsed.data } }) });
      setData(defaultScheduleSnapshotSchema.parse(raw)); setEditing(false); setMessage("Horário salvo. Alterações do encarregado são notificadas ao ADMIN e RH.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  const current = data?.setting?.payload;
  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  return <section aria-label="Horário padrão" className="space-y-3 rounded-xl border border-slate-200 p-3.5">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Horário padrão</h3>{data?.canEdit && !editing ? <button type="button" className={buttonClass} onClick={edit}>{current ? "Editar horário" : "Cadastrar horário"}</button> : null}</div>
    {!editing ? current ? <div className="space-y-1 text-sm"><p className="font-medium">{String(current.name)}</p><p>{String(current.start)} às {String(current.end)} · Almoço: {Number(current.lunchMinutes ?? 60)} min</p><p className="text-xs text-slate-600">{current.cycle ? `12×36 · plantão de referência ${(current.cycle as { anchorDate: string }).anchorDate.split("-").reverse().join("/")}` : (current.days as number[]).map(d => weekdays[d]).join(" · ")}</p>{current.monthlySundayOff === true ? <p className="text-xs text-amber-800">Folga aos sábados e um domingo por mês. Domingos sem data definida ficam pendentes de conferência.</p> : null}{current.weeklyRosterConfirmed === false ? <p className="text-xs text-amber-800">Dias de trabalho e folga aguardam conferência. Sem falta automática por esta escala.</p> : null}{current.estimated === true ? <p className="text-xs text-amber-800">Horário estimado pelas batidas; confira antes de apurar atraso.</p> : null}<p className="text-xs text-slate-500">Vigência: {data!.setting!.validFrom.split("-").reverse().join("/")}</p></div> : <p className="text-sm text-slate-600">{data ? "Horário ainda não cadastrado." : "Carregando horário…"}</p> : null}
    {editing ? <form onSubmit={save} className="space-y-3">
      <Field label="Horário de referência"><select className={inputClass} value="" onChange={e => { if (e.target.value) setDraft({ ...standardPayload(e.target.value), ...(e.target.value.startsWith("app-") ? { weeklyRosterConfirmed: true, cycle: { kind: "12x36", anchorDate: validFrom } } : {}) }); }}><option value="">Escolha um padrão ou edite abaixo</option>{STANDARD_SCHEDULES.map(s => <option key={s.id} value={s.id}>{s.name} · {s.start}–{s.end}</option>)}</select></Field>
      <Field label="Nome do horário"><input required maxLength={200} className={inputClass} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Entrada padrão"><input required type="time" className={inputClass} value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value, estimated: false })} /></Field><Field label="Saída padrão"><input required type="time" className={inputClass} value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value, estimated: false })} /></Field></div>
      <p className="text-xs text-slate-600">Almoço: 1 hora. Trabalho previsto: {durationMinutes(draft.start, draft.end)-60} minutos. A saída menor que a entrada pertence ao dia seguinte.</p>
      <Field label="Ciclo de trabalho"><select className={inputClass} value={draft.cycle ? "12x36" : draft.weeklyRosterConfirmed ? "weekly" : "pending"} onChange={e => setDraft({ ...draft, cycle: e.target.value === "12x36" ? { kind: "12x36", anchorDate: validFrom } : undefined, weeklyRosterConfirmed: e.target.value !== "pending", days: e.target.value === "12x36" ? [0,1,2,3,4,5,6] : draft.days })}><option value="pending">Dias de folga a confirmar</option><option value="weekly">Dias fixos da semana</option><option value="12x36">12×36</option></select></Field>
      {draft.cycle ? <Field label="Data de um plantão de trabalho"><input type="date" required className={inputClass} value={draft.cycle.anchorDate} onChange={e => setDraft({ ...draft, cycle: { kind: "12x36", anchorDate: e.target.value } })} /></Field> : draft.weeklyRosterConfirmed ? <fieldset><legend className="text-xs font-semibold">Dias de trabalho</legend><div className="flex flex-wrap gap-3">{weekdays.map((name, day) => <label key={day} className="flex min-h-10 items-center gap-1 text-sm"><input type="checkbox" checked={draft.days.includes(day)} onChange={e => setDraft({ ...draft, days: e.target.checked ? [...draft.days,day] : draft.days.filter(d => d !== day) })} />{name}</label>)}</div></fieldset> : null}
      {!draft.cycle ? <><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={!!draft.monthlySundayOff} onChange={e=>setDraft({...draft,monthlySundayOff:e.target.checked})} />Uma folga de domingo por mês (noturno)</label>{draft.monthlySundayOff ? <Field label="Domingo de folga no mês da vigência (opcional)"><input type="date" className={inputClass} value={draft.monthlySundayOffDates?.find(d=>d.slice(0,7)===validFrom.slice(0,7)) ?? ""} onChange={e=>setDraft({...draft,monthlySundayOffDates:[...(draft.monthlySundayOffDates ?? []).filter(d=>d.slice(0,7)!==validFrom.slice(0,7)),...(e.target.value?[e.target.value]:[])]})} /><span className="text-xs text-slate-500">Sem data definida, domingos desse mês não geram falta automática.</span></Field> : null}</> : null}
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={!draft.estimated} onChange={e => setDraft({ ...draft, estimated: !e.target.checked, weeklyRosterConfirmed: e.target.checked ? draft.weeklyRosterConfirmed : false, cycle: e.target.checked ? draft.cycle : undefined })} />Entrada e saída conferidas</label>
      <Field label="Válido a partir de"><input required type="date" className={inputClass} value={validFrom} onChange={e => setValidFrom(e.target.value)} /></Field>
      <Field label="Motivo da alteração"><textarea required minLength={5} maxLength={1000} className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="flex gap-2"><button disabled={busy} className={primaryClass}>{busy ? "Salvando…" : "Salvar horário"}</button><button disabled={busy} type="button" className={buttonClass} onClick={() => setEditing(false)}>Cancelar</button></div>
    </form> : null}
    {message ? <div role="status" className="text-sm text-blue-900">{message}{!editing ? <button type="button" className={`${buttonClass} ml-2`} onClick={() => setReload(v => v+1)}>Recarregar horário</button> : null}</div> : null}
  </section>;
}
