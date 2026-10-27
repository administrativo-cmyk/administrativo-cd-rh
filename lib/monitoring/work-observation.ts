import { DEFAULT_REPETITION_POLICY, isEffective, normalizeAccessLabel, preparePunches } from "./domain";
import type { AccessEvent, AccessPointMapping, PunchEvent } from "./domain";

type Role = NonNullable<PunchEvent["role"]>;
export interface WorkSuggestion { at: number; eventId: string; pointId: string; sourceId: string; role: Role }
export interface WorkObservation {
  workedSeconds: number;
  restSeconds: number;
  basis: "clock-pair" | "turnstile-suggestion";
  reason: string;
  restBasis?: "clock" | "not-recorded" | "turnstile-suggestion";
  suggestedMarks?: WorkSuggestion[];
  restSuggestion?: { start: number; end: number; exitEventId: string; entryEventId: string; outsideSeconds: number };
  exitSuggestion?: { at: number; eventId: string; pointId: string; sourceId: string };
}
const minute = 60_000;

/** Auxiliary observation only. Complete point sequences never acquire access marks. */
export function observeIncompleteWork(input: {
  employeeId: string; date: string; punches: PunchEvent[]; accesses: AccessEvent[];
  mappings: AccessPointMapping[]; window: { start: number; end: number };
  schedule: { start: number; end: number } | null; referenceAt: number;
  slots?: Array<{ role: Role; at: number | null; eventId?: string }>;
  missingRole?: Role | null;
}): WorkObservation | null {
  const prepared = preparePunches(input.punches, DEFAULT_REPETITION_POLICY), punches = prepared.events;
  if (prepared.issues.length || !input.schedule || punches.length < 1 || punches.length > 3) return null;
  const clocks = new Map<Role, number>();
  if (punches.every(p => p.role)) {
    for (const punch of punches) { if (clocks.has(punch.role!)) return null; clocks.set(punch.role!, punch.at); }
  } else if (punches.length === 3 && input.missingRole && input.slots?.length === 4) {
    for (const slot of input.slots) if (slot.at !== null) {
      const punch = punches.find(p => p.at === slot.at && (!slot.eventId || p.id === slot.eventId));
      if (!punch || (punch.role && punch.role !== slot.role)) return null;
      clocks.set(slot.role, slot.at);
    }
    if (clocks.size !== 3 || clocks.has(input.missingRole)) return null;
  } else {
    if (punches.some(p => p.role) || Math.abs(punches[0].at - input.schedule.start) > 3 * 3_600_000) return null;
    clocks.set("start", punches[0].at);
    if (punches.length === 2) {
      if (punches[1].at < input.schedule.end - 4 * 3_600_000) return null;
      clocks.set("end", punches[1].at);
    } else if (punches.length !== 1) return null;
  }
  const transitions = input.accesses.flatMap(event => {
    if (!event.authorized || !event.identified || event.personId !== input.employeeId || event.provenance?.origin === "manual"
      || event.at < input.window.start || event.at >= input.window.end || event.at > input.referenceAt) return [];
    const mappings = input.mappings.filter(mapping => mapping.validated && mapping.area === "operation" && isEffective(mapping, input.date)
      && normalizeAccessLabel(mapping.pointId) === normalizeAccessLabel(event.pointId)
      && mapping.eventClasses.some(value => normalizeAccessLabel(value) === normalizeAccessLabel(event.eventClass)));
    return mappings.length === 1 ? [{ event, direction: mappings[0].direction }] : [];
  }).sort((a, b) => a.event.at - b.event.at || a.event.id.localeCompare(b.event.id));
  const ambiguous = new Set(transitions.filter((t, i, all) => all.some((other, j) => j !== i && other.event.at === t.event.at && other.direction !== t.direction)).map(t => t.event.at));
  const suggestedMarks: WorkSuggestion[] = [];
  const suggest = (event: AccessEvent, role: Role) => { clocks.set(role, event.at); suggestedMarks.push({ at: event.at, eventId: event.id, pointId: event.pointId, sourceId: event.sourceId, role }); };
  if (!clocks.has("start")) {
    const firstClock = Math.min(...clocks.values());
    const first = transitions.find(t => t.direction === "entry" && t.event.at < firstClock && Math.abs(t.event.at - input.schedule!.start) <= 3 * 3_600_000);
    if (!first || ambiguous.has(first.event.at)) return null;
    suggest(first.event, "start");
  }
  const start = clocks.get("start")!;
  if (!clocks.has("end")) {
    // Do not mistake a lunch exit from an open operational window for the final exit.
    if (input.referenceAt < input.window.end) return null;
    const last = transitions.filter(t => t.event.at > Math.max(...clocks.values())).at(-1);
    if (!last || last.direction !== "exit" || ambiguous.has(last.event.at) || last.event.at < input.schedule.end - 4 * 3_600_000) return null;
    suggest(last.event, "end");
  }
  const end = clocks.get("end")!;
  if (end <= start || end - start > 18 * 3_600_000 || end - start < 2 * 3_600_000 || end > input.referenceAt || end >= input.window.end) return null;
  let restSuggestion: WorkObservation["restSuggestion"];
  if (!clocks.has("breakStart") || !clocks.has("breakEnd")) {
    const intervals: Array<{ exit: AccessEvent; entry: AccessEvent }> = [];
    let exit: AccessEvent | undefined;
    for (const transition of transitions) {
      if (transition.event.at <= start || transition.event.at >= end) continue;
      if (ambiguous.has(transition.event.at)) { exit = undefined; continue; }
      if (transition.direction === "exit") {
        if (!exit || transition.event.at - exit.at >= minute) exit = transition.event;
      }
      else if (exit) { intervals.push({ exit, entry: transition.event }); exit = undefined; }
    }
    const candidates = intervals.filter(pair => pair.entry.at - pair.exit.at >= 15 * minute
      && (!clocks.has("breakStart") || Math.abs(pair.exit.at - clocks.get("breakStart")!) <= 15 * minute)
      && (!clocks.has("breakEnd") || Math.abs(pair.entry.at - clocks.get("breakEnd")!) <= 15 * minute))
      .sort((a, b) => (b.entry.at - b.exit.at) - (a.entry.at - a.exit.at) || a.exit.at - b.exit.at);
    const longest = candidates[0];
    if (longest) {
      if (!clocks.has("breakStart")) suggest(longest.exit, "breakStart");
      if (!clocks.has("breakEnd")) suggest(longest.entry, "breakEnd");
      restSuggestion = { start: clocks.get("breakStart")!, end: clocks.get("breakEnd")!, exitEventId: longest.exit.id,
        entryEventId: longest.entry.id, outsideSeconds: (longest.entry.at - longest.exit.at) / 1000 };
    } else if (punches.length === 3 || clocks.has("breakStart") || clocks.has("breakEnd")) return null;
  }
  const hasBreak = clocks.has("breakStart") && clocks.has("breakEnd");
  const breakStart = clocks.get("breakStart"), breakEnd = clocks.get("breakEnd");
  if (hasBreak && !(start < breakStart! && breakStart! < breakEnd! && breakEnd! < end)) return null;
  if (punches.some(p => ![...clocks.values()].includes(p.at))) return null;
  const restSeconds = hasBreak ? (breakEnd! - breakStart!) / 1000 : 0;
  const last = suggestedMarks.find(mark => mark.role === "end");
  return { workedSeconds: (end - start) / 1000 - restSeconds, restSeconds,
    basis: suggestedMarks.length ? "turnstile-suggestion" : "clock-pair",
    restBasis: restSuggestion ? "turnstile-suggestion" : hasBreak ? "clock" : "not-recorded", suggestedMarks,
    ...(restSuggestion ? { restSuggestion } : {}), ...(last ? { exitSuggestion: last } : {}),
    reason: restSuggestion ? "Intervalo sugerido pelo maior período válido entre saída e retorno à operação (mínimo de 15 minutos), descontado somente no cálculo observado. Saída da operação não comprova descanso. Ponto original, banco e RH preservados."
      : "Cálculo observado com os horários existentes e eventuais sugestões do torniquete; sem descanso registrado quando não há par de intervalo. Não altera ponto, banco ou RH." };
}
