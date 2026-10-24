"use client";

import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import { attendanceHistorySnapshotSchema } from "@/lib/monitoring/attendance-history-contracts";
import { todayInSaoPaulo } from "@/lib/data/daily-call-dates";
import { cn } from "@/lib/utils";
import { runPeriodPunchRead } from "@/lib/monitoring/period-punch-requests";

type History = z.infer<typeof attendanceHistorySnapshotSchema>;
type State =
  | { key: string; status: "ready"; days: History["days"] }
  | { key: string; status: "error"; message: string };
const clock = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const fullTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
function markLabel(at: number, journeyDate: string) {
  const suffix = todayInSaoPaulo(new Date(at)) === journeyDate ? "" : ` ${weekday.format(at).charAt(0).toUpperCase()}`;
  return `${clock.format(at)}${suffix}`;
}
const roles = { start: "Entrada", breakStart: "Saída para intervalo", breakEnd: "Retorno do intervalo", end: "Saída do expediente" } as const;

/** Uses the same authorized operational dates and effective marks as the employee's history. */
export function PeriodPunchRow({ id, employeeId, employeeName, dates, collapsed }: {
  id: string; employeeId: string; employeeName: string; dates: string[]; collapsed: boolean;
}) {
  const start = dates[0], end = dates.at(-1);
  const today = todayInSaoPaulo();
  const historyEnd = end && end < today ? end : today;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State | null>(null);
  const key = `${employeeId}:${start}:${end}:${revision}`;
  useEffect(() => {
    if (!start || !end || start > today) return;
    const controller = new AbortController();
    async function load() {
      try {
        const history = await runPeriodPunchRead(controller.signal, async () => {
          const response = await fetch(`/api/monitoring/attendance-history?${new URLSearchParams({ employeeId, start, end: historyEnd })}`, { cache: "no-store", signal: controller.signal });
          const value = await response.json();
          if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "Não foi possível carregar as batidas.");
          const parsed = attendanceHistorySnapshotSchema.safeParse(value);
          if (!parsed.success) throw new Error("O servidor não confirmou as batidas. Tente novamente.");
          return parsed.data;
        });
        if (!controller.signal.aborted) setState({ key, status: "ready", days: history.days });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, status: "error", message: error instanceof Error ? error.message : "Não foi possível carregar as batidas." });
      }
    }
    void load();
    return () => controller.abort();
  }, [employeeId, start, end, historyEnd, today, key]);
  const current = state?.key === key ? state : null;
  const days = useMemo(() => new Map(current?.status === "ready" ? current.days.map(day => [day.date, day]) : []), [current]);

  return <tr id={id} aria-label={`Batidas de ${employeeName}`} className="bg-blue-50/50">
    <th scope="row" colSpan={collapsed ? 1 : 7} className="sticky left-0 z-30 border-b border-r border-slate-200 bg-blue-50 px-2 py-2 text-left align-top font-normal shadow-[4px_0_8px_-5px_rgb(15_23_42/50%)]">
      <span className="block text-[10px] font-semibold text-blue-950">Batidas do ponto</span>
      <span className="block text-[9px] leading-3 text-slate-600">São Paulo · noturno no dia de entrada</span>
      <span className="block text-[9px] leading-3 text-slate-600">Letra após a hora: dia da batida em outra data</span>
    </th>
    {!current && start <= today ? <td colSpan={dates.length} className="border-b border-slate-200 p-2 text-xs text-slate-600"><span role="status">Carregando batidas de {employeeName}…</span></td>
      : current?.status === "error" ? <td colSpan={dates.length} className="border-b border-slate-200 p-2"><div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-rose-800"><span>{current.message}</span><button type="button" onClick={() => setRevision(value => value + 1)} className="rounded border border-rose-300 bg-white px-2 py-1 text-rose-900 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-blue-600" aria-label={`Tentar carregar batidas de ${employeeName} novamente`}>Tentar novamente</button></div></td>
        : dates.map(date => {
          const day = days.get(date);
          const bankDay = day?.bankDay;
          const marks = day?.displayMarks ?? (bankDay?.slots.length ? bankDay.slots : (bankDay?.punches ?? []));
          const missingDescription = date > today ? "Data futura" : "Jornada ainda não apurada";
          const description = `${date.split("-").reverse().join("/")} · ${day?.displayReason ?? bankDay?.reason ?? missingDescription}`;
          return <td key={date} data-punch-date={date} aria-label={`${employeeName}, batidas de ${date.split("-").reverse().join("/")}`} title={description} className="overflow-hidden border-b border-r border-slate-200 px-px py-1.5 text-center align-top">
            {marks.length ? marks.map((mark, index) => mark.at === null
              ? <span key={index} className="block whitespace-nowrap text-[9px] leading-3 font-semibold text-amber-800" title={mark.role ? `${roles[mark.role]}: batida faltante, aguardando RH ou ADMIN` : "Batida faltante"} aria-label={mark.role ? `${roles[mark.role]}: batida faltante` : "Batida faltante"}>--:--</span>
              : <time key={index} dateTime={new Date(mark.at).toISOString()} title={`${fullTime.format(mark.at)} · ${weekday.format(mark.at)}${mark.role ? ` · ${roles[mark.role]}` : ""}`} aria-label={`${fullTime.format(mark.at)}${mark.role ? ` · ${roles[mark.role]}` : ""}`} className={cn("block whitespace-nowrap text-[9px] leading-3 font-medium tabular-nums text-slate-700", bankDay?.originalPunches && "text-blue-800")}>{markLabel(mark.at, date)}</time>)
              : <span className="text-[10px] text-slate-500" aria-label={bankDay ? "Sem batidas no histórico" : missingDescription}>—</span>}
          </td>;
        })}
  </tr>;
}
