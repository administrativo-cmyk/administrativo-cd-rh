import { DEFAULT_REPETITION_POLICY, isEffective, normalizeAccessLabel, preparePunches } from "./domain";
import type { AccessEvent, AccessPointMapping, PunchEvent } from "./domain";

export interface WorkObservation {
  workedSeconds: number;
  restSeconds: number;
  basis: "clock-pair" | "turnstile-suggestion";
  reason: string;
  exitSuggestion?: { at: number; eventId: string; pointId: string; sourceId: string };
}

/** Auxiliary observation only. Never changes punches, payroll or location evidence. */
export function observeIncompleteWork(input: {
  employeeId: string; date: string; punches: PunchEvent[]; accesses: AccessEvent[];
  mappings: AccessPointMapping[]; window: { start: number; end: number };
  schedule: { start: number; end: number } | null; referenceAt: number;
}): WorkObservation | null {
  const prepared = preparePunches(input.punches, DEFAULT_REPETITION_POLICY);
  const punches = prepared.events;
  if (prepared.issues.length || prepared.suppressions.length || !input.schedule || ![1, 2].includes(punches.length)) return null;
  const first = punches[0];
  if (first.role && first.role !== "start") return null;
  // A mark around the middle/end cannot safely stand for the missing entry.
  if (Math.abs(first.at - input.schedule.start) > 3 * 3_600_000) return null;
  const validSpan = (end: number) => end > first.at && end - first.at <= 18 * 3_600_000 && end < input.window.end && end <= input.referenceAt;
  if (punches.length === 2) {
    const last = punches[1];
    if ((last.role && last.role !== "end") || !validSpan(last.at) || last.at - first.at < 2 * 3_600_000) return null;
    return { workedSeconds: (last.at - first.at) / 1000, restSeconds: 0, basis: "clock-pair",
      reason: "Duração entre entrada e saída do ponto; sem descanso registrado. Não comprova ausência de pausa e não substitui o banco de horas." };
  }
  // Do not mistake the lunch exit of an ongoing shift for the final exit.
  if (input.referenceAt < input.schedule.end + 30 * 60_000) return null;
  const transitions = input.accesses.flatMap(event => {
    if (!event.authorized || !event.identified || event.personId !== input.employeeId || event.provenance?.origin === "manual"
      || event.at <= first.at || event.at >= input.window.end || event.at > input.referenceAt || event.at - first.at > 18 * 3_600_000) return [];
    const mappings = input.mappings.filter(mapping => mapping.validated && mapping.area === "operation" && isEffective(mapping, input.date)
      && normalizeAccessLabel(mapping.pointId) === normalizeAccessLabel(event.pointId)
      && mapping.eventClasses.some(value => normalizeAccessLabel(value) === normalizeAccessLabel(event.eventClass)));
    return mappings.length === 1 ? [{ event, direction: mappings[0].direction }] : [];
  }).sort((a, b) => a.event.at - b.event.at || a.event.id.localeCompare(b.event.id));
  const last = transitions.at(-1);
  if (!last || last.direction !== "exit" || !validSpan(last.event.at) || last.event.at < input.schedule.end - 4 * 3_600_000
    || last.event.at - first.at < 2 * 3_600_000) return null;
  if (transitions.some(item => item.event.at === last.event.at && item.direction !== "exit")) return null;
  return { workedSeconds: (last.event.at - first.at) / 1000, restSeconds: 0, basis: "turnstile-suggestion",
    reason: "Saída sugerida pela última saída válida do torniquete na jornada; sem descanso registrado. Acesso à operação não comprova saída do CD. Cálculo auxiliar, sem alteração do ponto ou do banco.",
    exitSuggestion: { at: last.event.at, eventId: last.event.id, pointId: last.event.pointId, sourceId: last.event.sourceId } };
}
