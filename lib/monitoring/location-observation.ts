import { DEFAULT_REPETITION_POLICY, isEffective, normalizeAccessLabel, preparePunches } from "./domain";
import { durationMs, intersectIntervals, operationalDateAt, subtractIntervals } from "./domain/intervals";
import type { AccessEvent, AccessPointMapping, Interval, PunchEvent } from "./domain";
import type { WorkObservation } from "./work-observation";

export interface LocationObservation {
  quality: "observed-partial";
  window: Interval;
  outsideSeconds: number | null;
  cafeteriaSeconds: number | null;
  outsideGrossSeconds: number | null;
  cafeteriaGrossSeconds: number | null;
  cafeteriaWithinSuggestedRestSeconds: number | null;
  outsidePairs: number;
  cafeteriaPairs: number;
  reason: string;
}

/** Observational attribution only; never creates an employee schedule or official evidence. */
export function unscheduledObservationWindow(punches: PunchEvent[], date: string): { punches: PunchEvent[]; window: Interval } {
  const midnight = Date.parse(`${date}T00:00:00-03:00`), day = 86_400_000;
  const prepared = preparePunches(punches, DEFAULT_REPETITION_POLICY).events;
  const assigned = new Map<string, string>();
  // Match the existing period display: bounded night sequences with internal marks.
  for (const anchor of [midnight - day, midnight]) {
    const marks = prepared.filter(p => p.at >= anchor + 18 * 3_600_000 && p.at <= anchor + 36 * 3_600_000);
    if (marks.length < 3 || marks.length > 6 || marks[0].at >= anchor + day || marks.at(-1)!.at < anchor + day
      || marks.at(-1)!.at - marks[0].at > 18 * 3_600_000
      || marks.some((p, i) => i > 0 && p.at - marks[i - 1].at > 8 * 3_600_000) || marks.some(p => assigned.has(p.id))) continue;
    for (const mark of marks) assigned.set(mark.id, operationalDateAt(marks[0].at));
  }
  let selected = prepared.filter(p => (assigned.get(p.id) ?? operationalDateAt(p.at)) === date);
  // Early exit + late entry can be two night shifts; do not call them one long day.
  if (selected.length === 2 && !selected.some(p => assigned.has(p.id))
    && selected[0].at < midnight + 8 * 3_600_000 && selected[1].at >= midnight + 18 * 3_600_000) selected = [];
  const previousNightEnd = prepared.filter(p => p.at >= midnight && assigned.has(p.id) && assigned.get(p.id)! < date).at(-1)?.at;
  const last = selected.at(-1)?.at ?? midnight;
  return { punches: selected, window: { start: previousNightEnd === undefined ? midnight : previousNightEnd + 1, end: Math.max(midnight + day, last + 1) } };
}

/** Closed, directly observed pairs only. No coverage assertion, open-pair extrapolation or zero for missing data. */
export function observeLocations(input: {
  employeeId: string; date: string; accesses: AccessEvent[]; mappings: AccessPointMapping[];
  punches: PunchEvent[]; window: Interval; referenceAt: number; workObservation: WorkObservation | null;
}): LocationObservation | null {
  const prepared = preparePunches(input.punches, DEFAULT_REPETITION_POLICY);
  const clocks = prepared.events;
  const recordedRest: Interval[] = [];
  let span = input.workObservation?.span ?? null;
  if (!prepared.issues.length && clocks.length >= 2) {
    const typed = clocks.every(p => p.role);
    const start = typed ? clocks.find(p => p.role === "start")?.at : clocks[0].at;
    const end = typed ? clocks.find(p => p.role === "end")?.at : clocks.at(-1)!.at;
    if (!span && start !== undefined && end !== undefined && end > start && end - start <= 18 * 3_600_000
      && (typed || clocks.length % 2 === 0)) span = { start, end };
    if (typed) {
      const start = clocks.find(p => p.role === "breakStart")?.at, end = clocks.find(p => p.role === "breakEnd")?.at;
      if (start !== undefined && end !== undefined && end > start) recordedRest.push({ start, end });
    } else if (clocks.length >= 4 && clocks.length <= 6 && clocks.length % 2 === 0) {
      for (let i = 1; i + 1 < clocks.length; i += 2) recordedRest.push({ start: clocks[i].at, end: clocks[i + 1].at });
    }
  }
  const window = span ?? { start: input.window.start, end: Math.min(input.window.end, input.referenceAt) };
  if (window.end <= window.start) return null;
  const suggestedRest = input.workObservation?.restSuggestion ? [input.workObservation.restSuggestion] : [];
  const pair = (area: "operation" | "cafeteria"): Interval[] => {
    const transitions = input.accesses.flatMap(event => {
      if (!event.authorized || !event.identified || event.personId !== input.employeeId || event.provenance?.origin === "manual"
        || event.at < input.window.start || event.at >= input.window.end || event.at > input.referenceAt) return [];
      const matches = input.mappings.filter(mapping => mapping.validated && isEffective(mapping, input.date)
        && normalizeAccessLabel(mapping.pointId) === normalizeAccessLabel(event.pointId)
        && mapping.eventClasses.some(value => normalizeAccessLabel(value) === normalizeAccessLabel(event.eventClass)));
      return matches.length === 1 && matches[0].area === area ? [{ at: event.at, direction: matches[0].direction }] : [];
    }).sort((a, b) => a.at - b.at);
    const result: Interval[] = [];
    let opened: number | null = null;
    for (let i = 0; i < transitions.length;) {
      const at = transitions[i].at, simultaneous = [];
      while (i < transitions.length && transitions[i].at === at) simultaneous.push(transitions[i++].direction);
      if (new Set(simultaneous).size !== 1) { opened = null; continue; }
      const opening = simultaneous[0] === (area === "operation" ? "exit" : "entry");
      if (opening) { if (opened === null || at - opened >= 60_000) opened = at; }
      else if (opened !== null) { if (at > opened) result.push({ start: opened, end: at }); opened = null; }
    }
    return intersectIntervals(result, [window]);
  };
  const outside = pair("operation"), cafeteria = pair("cafeteria");
  if (!outside.length && !cafeteria.length) return null;
  const seconds = (pairs: Interval[], excluded: Interval[]) => pairs.length ? durationMs(subtractIntervals(pairs, excluded)) / 1000 : null;
  return { quality: "observed-partial", window,
    outsideSeconds: seconds(outside, [...recordedRest, ...suggestedRest]),
    cafeteriaSeconds: seconds(cafeteria, recordedRest),
    outsideGrossSeconds: seconds(outside, []), cafeteriaGrossSeconds: seconds(cafeteria, []),
    cafeteriaWithinSuggestedRestSeconds: cafeteria.length ? durationMs(intersectIntervals(subtractIntervals(cafeteria, recordedRest), suggestedRest)) / 1000 : null,
    outsidePairs: outside.length, cafeteriaPairs: cafeteria.length,
    reason: "Tempos observados em pares fechados de leitores validados; cobertura parcial. Fora da operação desconta a união dos intervalos registrados e sugeridos, uma única vez. Refeitório desconta somente intervalo marcado no ponto; dentro de intervalo apenas sugerido continua contado. Sem alteração de ponto, banco ou RH." };
}
