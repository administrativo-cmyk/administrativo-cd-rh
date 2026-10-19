import { DEFAULT_REPETITION_POLICY, preparePunches, normalizeAccessLabel, isEffective } from "./domain";
import type { AccessEvent, AccessPointMapping, PunchEvent } from "./domain";

export const punchRoles = ["start", "breakStart", "breakEnd", "end"] as const;
export type PunchRole = typeof punchRoles[number];
export interface BankDay {
  state: "ready" | "pending";
  reason: string;
  expectedMinutes: number | null;
  workedMinutes: number | null;
  deltaMinutes: number | null;
  punches: Array<{ id: string; at: number; sourceId: string; role?: PunchRole }>;
  slots: Array<{ role: PunchRole; at: number | null; eventId?: string }>;
  missingRole: PunchRole | null;
  suggestions: Array<{ at: number; eventId: string; pointId: string; direction: "entry" | "exit"; differenceMinutes: number }>;
  suppressedIds: string[];
  originalPunches?: Array<{ id:string; at:number; sourceId:string }>;
}

/** Payroll arithmetic is separate from location evidence; no access timestamp becomes a punch without RH approval. */
export function assessBankDay(input: {
  date: string; punches: PunchEvent[]; accesses: AccessEvent[]; mappings: AccessPointMapping[];
  schedule: { start: number; end: number; lunchMinutes: number; confirmed: boolean; expectedMinutes?: number } | null;
  closed: boolean; collectionComplete: boolean; protected: boolean; conflicted: boolean;
}): BankDay {
  const prepared = preparePunches(input.punches, DEFAULT_REPETITION_POLICY);
  const punches = prepared.events;
  const schedule = input.schedule;
  const expectedMinutes = schedule ? schedule.expectedMinutes ?? Math.round((schedule.end - schedule.start) / 60_000) - schedule.lunchMinutes : null;
  const output: BankDay = { state: "pending", reason: "Batidas incompletas", expectedMinutes, workedMinutes: null, deltaMinutes: null,
    punches: punches.map(({ id, at, sourceId, role }) => ({ id, at, sourceId, role })), slots: [], missingRole: null, suggestions: [], suppressedIds: prepared.suppressions.map(s => s.eventId) };
  if (schedule && punches.length === 3) {
    const lunchStart = schedule.start + (schedule.end - schedule.start - schedule.lunchMinutes * 60_000) / 2;
    const targets = [schedule.start, lunchStart, lunchStart + schedule.lunchMinutes * 60_000, schedule.end];
    const alternatives = punchRoles.map((role, missing) => {
      const indices = [0, 1, 2, 3].filter(index => index !== missing);
      return { role, missing, score: punches.reduce((score, punch, i) => score + Math.abs(punch.at - targets[indices[i]]) + (punch.role && punch.role !== punchRoles[indices[i]] ? 1e15 : 0), 0) };
    }).sort((a, b) => a.score - b.score);
    // A tie is not enough evidence to suggest a particular missing role.
    if (alternatives[1].score - alternatives[0].score >= 15 * 60_000) {
      const { missing, role } = alternatives[0]; let index = 0;
      output.missingRole = role;
      output.slots = punchRoles.map((slot, i) => i === missing ? { role: slot, at: null } : { role: slot, at: punches[index].at, eventId: punches[index++].id });
      const before = missing ? output.slots[missing - 1].at! : schedule.start - 3_600_000;
      const after = missing < 3 ? output.slots[missing + 1].at! : schedule.end + 3_600_000;
      const direction = missing === 0 || missing === 2 ? "entry" : "exit";
      for (const event of input.accesses) {
        if (!event.authorized || !event.identified || event.personId !== punches[0].personId || event.provenance?.origin === "manual" || event.at <= before || event.at >= after || Math.abs(event.at - targets[missing]) > 120 * 60_000) continue;
        const mappings = input.mappings.filter(mapping => mapping.validated && ((mapping.area === "perimeter" || mapping.area === "operation") && mapping.direction === direction)
          && normalizeAccessLabel(mapping.pointId) === normalizeAccessLabel(event.pointId)
          && mapping.eventClasses.some(value => normalizeAccessLabel(value) === normalizeAccessLabel(event.eventClass)) && isEffective(mapping, input.date));
        if (mappings.length !== 1) continue;
        output.suggestions.push({ at: event.at, eventId: event.id, pointId: event.pointId, direction, differenceMinutes: Math.round(Math.abs(event.at - targets[missing]) / 60_000) });
      }
      output.suggestions.sort((a, b) => a.differenceMinutes - b.differenceMinutes || a.at - b.at);
      output.suggestions = output.suggestions.slice(0, 5);
    }
  }
  if (!schedule?.confirmed || expectedMinutes === null || expectedMinutes < 0) output.reason = "Horário padrão precisa ser confirmado";
  else if (input.protected) output.reason = "Afastamento ou desligamento: conferir com RH";
  else if (input.conflicted || prepared.issues.length || punches.some((p, i) => i > 0 && p.at <= punches[i - 1].at)) output.reason = "Batidas conflitantes: conferir com RH";
  else if (!input.closed) output.reason = "Expediente ainda aberto";
  else if (!input.collectionComplete) output.reason = "Coleta do período ainda não confirmada como completa";
  else if (punches.length === 0 && expectedMinutes === 0) { output.state = "ready"; output.reason = "Folga confirmada"; output.workedMinutes = 0; output.deltaMinutes = 0; }
  else if (punches.length === 3) output.reason = "Falta uma batida; somente RH ou ADMIN pode corrigir";
  else if (punches.length === 2 || punches.length === 4) {
    // User rule: two marks always deduct one hour for lunch, even for a shortened interval.
    const worked = punches.length === 2 ? Math.max(0, (punches[1].at - punches[0].at) / 60_000 - 60)
      : (punches[1].at - punches[0].at + punches[3].at - punches[2].at) / 60_000;
    output.workedMinutes = Math.round(worked);
    output.deltaMinutes = output.workedMinutes - expectedMinutes;
    output.state = "ready"; output.reason = punches.length === 2 ? "Duas batidas; descontada 1h de almoço" : "Quatro batidas conferidas";
    output.slots = punches.length === 4 ? punches.map((p, i) => ({ role: punchRoles[i], at: p.at, eventId: p.id })) : [{ role: "start", at: punches[0].at, eventId: punches[0].id }, { role: "end", at: punches[1].at, eventId: punches[1].id }];
  }
  return output;
}
