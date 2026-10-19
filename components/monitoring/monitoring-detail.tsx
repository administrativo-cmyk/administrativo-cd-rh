"use client";
import { EmployeePunchHistory } from "./employee-punch-history";

import { useEffect, useState } from "react";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { MonitoringRow } from "@/lib/monitoring/contracts";
import type { Interval, JourneyCalculation, Metric } from "@/lib/monitoring/domain/types";
import { buttonClass, calendarDate, duration, Field, inputClass, instant, primaryClass, Quality, requestJson } from "./shared";
import { issueLabels } from "./issue-labels";

type Detail = {
  results: Array<{ date: string; result: JourneyCalculation; dirty: boolean; computedAt: string; summary: Record<string, unknown> }>;
  events: Array<{ id: string; timestamp: string; type: string; device: string | null; classification: string; eligible: boolean; conflicted: boolean; provenance: Array<{ fileId: string; line: number; sheet: string | null; conflict: boolean }> | null }>;
};
const visitLabels: Record<string, string> = { beforePunch: "Antes do ponto", duringRest: "Durante descanso", fromOperation: "Vindo da operação", withoutPriorOperation: "Sem operação anterior confirmada", other: "Outra sequência" };
const areaLabels = { operation: "Operação", cafeteria: "Refeitório", perimeter: "Perímetro" };
const stateLabels = { inside: "Dentro", outside: "Fora", unknown: "Desconhecido" };
const eventLabels: Record<string, string> = { authorized: "Autorizado", denied: "Negado", alarm: "Alarme", anonymous: "Anônimo", unknown: "Desconhecido" };

function Periods({ periods, empty = "Nenhum intervalo confirmado." }: { periods: Interval[]; empty?: string }) {
  return periods.length ? <ol className="space-y-1 text-xs">{periods.map((period, index) => <li className="border-l-2 border-blue-300 pl-2" key={`${period.start}|${index}`}>{instant(period.start)} até {instant(period.end)} · <b>{duration((period.end - period.start) / 1000)}</b></li>)}</ol> : <p className="text-xs text-slate-500">{empty}</p>;
}
function MetricDetail({ title, metric }: { title: string; metric: Metric }) {
  return <section className="rounded-lg border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{title}</h4><Quality value={metric.quality} /></div><b className="mt-2 block text-lg">{duration(metric.milliseconds === null ? null : metric.milliseconds / 1000)}</b><p className="my-2 text-xs text-slate-600">Tempo com estado conhecido: {duration(metric.knownMs / 1000)} · Desconhecido: {duration(metric.unknownMs / 1000)} · Cobertura: {metric.coverageRatio === null ? "Não definida" : `${Math.round(metric.coverageRatio * 100)}%`}</p>{metric.eligibility.reasons.length ? <p className="mb-2 text-xs text-amber-900">Elegibilidade: {metric.eligibility.reasons.join("; ")}</p> : null}<Periods periods={metric.intervals} /></section>;
}

export function MonitoringDetail({ employee, start, end, canAdmin, onClose, onReprocessed }: { employee: MonitoringRow; start: string; end: string; canAdmin: boolean; onClose: () => void; onReprocessed: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [day, setDay] = useState(employee.date ?? start);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    requestJson<Detail>(`/api/monitoring/detail?${new URLSearchParams({ employeeId: employee.employeeId, start, end, date: day, offset: String(offset) })}`, { signal: abort.signal })
      .then((result) => { if (!abort.signal.aborted) { setData(result); setError(""); } })
      .catch((cause) => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha ao carregar detalhes."); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [employee.employeeId, start, end, day, offset, refresh]);
  async function reprocess() {
    if (reason.trim().length < 5) { setNotice("Informe um motivo com pelo menos cinco caracteres."); return; }
    setBusy(true); setNotice("");
    try {
      await requestJson("/api/monitoring/reprocess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: employee.employeeId, start: day, end: day, reason: reason.trim() }) });
      setNotice("Apuração recalculada. Confira a qualidade e as pendências abaixo."); setLoading(true); setRefresh((value) => value + 1); onReprocessed();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Não foi possível recalcular."); }
    finally { setBusy(false); }
  }
  const selected = data?.results.find((result) => result.date === day);
  const result = selected?.result;
  const coffeeWindowMissing = result?.issues.some((issue) => issue.code === "COFFEE_WINDOWS_NOT_CONFIGURED");
  return <Sheet open onOpenChange={(open) => !open && onClose()}><SheetContent className="w-full overflow-y-auto p-0 sm:max-w-[850px]" data-testid="monitoring-detail"><SheetHeader className="border-b border-slate-200 p-5 pr-10"><div className="flex items-center gap-3"><EmployeeAvatar name={employee.name} employeeId={employee.employeeId} size={48} /><div><SheetTitle>{employee.name}</SheetTitle><SheetDescription>{employee.employeeNumber} · {employee.unit} · {employee.manager ?? "Sem gestor"}</SheetDescription></div></div></SheetHeader>
    <div className="space-y-4 p-4 sm:p-5">
      <EmployeePunchHistory employeeId={employee.employeeId} date={day} initialStart={start} initialEnd={end} />
      <p className="text-xs text-slate-600">Horários de America/Sao_Paulo. Autorização facial indica passagem inferida; não comprova giro de torniquete.</p>
      <Field label="Data operacional"><input type="date" required className={inputClass} value={day} min={start} max={end} onChange={(event) => { setDay(event.target.value); setOffset(0); setLoading(true); setError(""); }} /></Field>
      {canAdmin ? <form className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3" onSubmit={(event) => { event.preventDefault(); void reprocess(); }}><Field label="Motivo do recálculo"><input className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5} maxLength={1000} placeholder="Ex.: escala e vínculos conferidos" /></Field><button className={primaryClass} disabled={busy}>{busy ? "Recalculando…" : "Recalcular esta jornada"}</button><p className="text-xs text-slate-600">Reavalia apenas esta pessoa e data, usando os dados e regras atuais.</p></form> : null}
      {notice ? <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{notice}</p> : null}
      {loading ? <p role="status">Carregando detalhes…</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}
      {result ? <>
        <section className="rounded-lg border border-slate-200 p-3"><h3 className="font-semibold">Jornada de {calendarDate(day)}</h3><p className="mt-1 text-xs text-slate-600">Calculada em {instant(selected!.computedAt)} · Regra {result.ruleVersion}</p>{selected!.dirty ? <p role="alert" className="mt-2 font-semibold text-amber-900">Dados ou regras mudaram. Resultado anterior: recalcule antes de usar.</p> : null}<dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-600">Trabalho monitorável</dt><dd className="font-semibold">{duration(result.workMs === null ? null : result.workMs / 1000)}</dd></div><div><dt className="text-xs text-slate-600">Descanso excluído</dt><dd className="font-semibold">{duration(result.restMs / 1000)}</dd></div><div><dt className="text-xs text-slate-600">Primeira entrada</dt><dd>{instant(result.journey.firstEntry)}</dd></div><div><dt className="text-xs text-slate-600">Saída final</dt><dd>{instant(result.journey.lastExit)}</dd></div></dl><h4 className="mb-2 mt-4 text-xs font-semibold">Períodos trabalhados</h4><Periods periods={result.journey.work} /><h4 className="mb-2 mt-4 text-xs font-semibold">Descanso oficial</h4><Periods periods={result.journey.rest} /><h4 className="mb-2 mt-4 text-xs font-semibold">Trecho provisório incluído na apuração parcial</h4><Periods periods={result.journey.provisionalWork} /></section>
        <div className="grid gap-3 sm:grid-cols-2"><MetricDetail title="Fora da operação com ponto aberto" metric={result.outsideOperation} /><MetricDetail title="Refeitório durante trabalho" metric={result.cafeteria} /><MetricDetail title="Fora do CD" metric={result.outsideCd} /><section className="rounded-lg border border-slate-200 p-3"><div className="flex justify-between gap-2"><h4 className="font-semibold">Atraso</h4><Quality value={result.lateness.quality} /></div><p className="mt-2 text-lg font-semibold">{duration(result.lateness.totalMs === null ? null : result.lateness.totalMs / 1000)}</p><p className="mt-1 text-xs">Excedente de 15 minutos: {duration(result.lateness.excessMs === null ? null : result.lateness.excessMs / 1000)}</p><p className="mt-2 text-xs text-slate-600">{result.lateness.reason ?? "Comparação com a escala vigente."}</p><p className="mt-3 text-xs">Café durante trabalho: {duration(result.coffeeDuringWorkMs === null ? null : result.coffeeDuringWorkMs / 1000)}</p></section></div>
        <section className="rounded-lg border border-slate-200 p-3"><h3 className="font-semibold">Comparação com o horário padrão</h3><p className="mt-2 text-sm">Trabalho previsto (desconta 1h de almoço): {duration(data?.results.find(item => item.date === day)?.summary.expectedWorkSeconds)}</p><p className="text-sm">Tempo extra apurado: {duration(data?.results.find(item => item.date === day)?.summary.overtimeSeconds)}</p><p className="mt-1 text-xs text-slate-500">Exige jornada completa e horário conferido. Saldo diário e integração com a medição aparecem no histórico de ponto acima.</p></section><section><h3 className="mb-2 font-semibold">Sequências do refeitório</h3>{result.cafeteriaVisits.length ? <ul className="space-y-2 text-xs">{result.cafeteriaVisits.map((visit, index) => <li className="rounded-lg border border-slate-200 p-3" key={index}><b>{visitLabels[visit.classification]}</b><p>{instant(visit.start)} até {instant(visit.end)}</p><p>Dentro do trabalho: {duration(visit.workMs / 1000)} · Na janela de café: {coffeeWindowMissing ? "Janela não cadastrada" : duration(visit.coffeeMs / 1000)}</p></li>)}</ul> : <p className="text-xs text-slate-600">Sem visita pareada neste dia.</p>}</section>
        <section><h3 className="mb-2 font-semibold">Episódios fora da operação</h3><p className="mb-2 text-xs text-slate-600">Permanência confirmada dentro da operação: {duration(result.insideOperationMs / 1000)}. Refeitório observado em todo o período: {duration(result.cafeteriaObservedMs === null ? null : result.cafeteriaObservedMs / 1000)}.</p><ul className="space-y-2 text-xs">{result.outsideOperationEpisodes.map((episode, index) => <li key={index} className="border-l-2 border-amber-400 pl-2"><b>{episode.kind === "lateOperationEntry" ? "Entrada na operação após abrir o ponto" : "Saída da operação"}</b><p>{instant(episode.start)} até {instant(episode.end)} · Dentro do trabalho: {duration(episode.workMs / 1000)}</p></li>)}</ul>{result.betweenOperationExitAndPrincipalEntry.length ? <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold">Intervalos entre saída da operação e entrada principal</summary><p className="my-2 text-xs text-slate-600">Intervalos entre eventos; não comprovam tempo fora do CD.</p><Periods periods={result.betweenOperationExitAndPrincipalEntry} /></details> : null}</section>
        <section><h3 className="mb-2 font-semibold">Linha do tempo por área</h3><ol className="space-y-1 text-xs">{result.location.map((period, index) => <li key={index} className="grid gap-1 border-l-4 border-slate-300 bg-slate-50 p-2 sm:grid-cols-[150px_1fr]"><b>{areaLabels[period.area]} · {stateLabels[period.state]}</b><span>{instant(period.start)} até {instant(period.end)}</span></li>)}</ol></section>
        <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Pendências e repetições ({result.issues.length + result.suppressions.length})</summary><ul className="mt-2 space-y-2 text-xs">{result.issues.map((issue, index) => <li key={index}>{issueLabels[issue.code] ?? issue.detail ?? "Pendência de conciliação"} · {issue.eventIds.length} evento(s) relacionado(s)</li>)}{result.suppressions.map((suppression) => <li key={suppression.eventId}>Repetição analítica preservada na origem. Diferença: {suppression.differenceMs / 1000}s. Regra: {suppression.ruleVersion}. Evento mantido: <code>{suppression.retainedEventId}</code>.</li>)}</ul></details>
      </> : !loading ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Nenhuma apuração disponível para esta data. Verifique vínculos, escala, batidas e cobertura.</p> : null}
      <section><h3 className="mb-2 font-semibold">Eventos e proveniência no período</h3><ol className="space-y-2">{data?.events.map((event) => <li key={event.id} className="rounded-lg border border-slate-200 p-3 text-xs"><div className="flex flex-wrap justify-between gap-1"><b>{instant(event.timestamp)} · {event.type === "punch" ? "Ponto" : "Acesso"}</b><span>{event.conflicted ? "Conflito" : event.eligible ? "Elegível" : "Não altera o estado"}</span></div><p>{event.device ?? "Relógio de ponto"} · {eventLabels[event.classification] ?? event.classification}</p><details className="mt-2"><summary className="cursor-pointer text-blue-800">Origem ({event.provenance?.length ?? 0})</summary><p className="my-1 break-all">Identificador do evento: <code>{event.id}</code></p><ul className="mt-1 break-all">{event.provenance?.map((source, index) => <li key={index}>Arquivo {source.fileId} · {source.sheet ? `Aba ${source.sheet} · ` : ""}Linha {source.line}{source.conflict ? " · conteúdo conflitante" : ""}</li>)}</ul></details></li>)}</ol>{!data?.events.length && !loading ? <p className="text-xs text-slate-600">Nenhum evento vinculado encontrado neste período.</p> : null}<div className="mt-3 flex justify-between gap-2"><button className={buttonClass} disabled={loading || offset === 0} onClick={() => { setLoading(true); setOffset((value) => Math.max(0, value - 100)); }}>Eventos anteriores</button><button className={buttonClass} disabled={loading || (data?.events.length ?? 0) < 100} onClick={() => { setLoading(true); setOffset((value) => value + 100); }}>Próximos eventos</button></div></section>
    </div></SheetContent></Sheet>;
}
